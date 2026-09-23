import { and, desc, eq, notInArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { UsageScanFileState } from '@engy/common';
import { getDb, type Db } from '../db/client';
import {
  usageSession,
  usageSessionDaily,
  usageTool,
  usageField,
  usageFile,
  usageCause,
  usageCall,
  usageContextItem,
  usageExpensiveCall,
  usageScanFile,
  usageSealedDate,
  workspaces,
  projects,
} from '../db/schema';
import type { AppState, UsageScanDispatchResult } from '../trpc/context';
import { dispatchUsageScan } from '../ws/server';
import { broadcastUsageChange } from '../ws/broadcast';
import { directMicroCents, getRatesMap, microCentsForTokens, microCentsToCents, rateFor } from './pricing';
import { USAGE_REDUCER_VERSION, invalidateStaleReducerSeals } from './rebuild';

// ── Daemon dispatch ───────────────────────────────────────────────────

const EMPTY_SCAN: UsageScanDispatchResult = { sessions: [], files: {}, newlySealedDates: [], staleSealSkips: 0 };

function loadKnownFiles(db: Db): Record<string, UsageScanFileState> {
  const rows = db.select().from(usageScanFile).all();
  const knownFiles: Record<string, UsageScanFileState> = {};
  for (const row of rows) {
    knownFiles[row.path] = {
      sizeBytes: row.sizeBytes,
      mtimeMs: row.mtimeMs,
      bytesScanned: row.bytesScanned,
      firstLineDate: row.firstLineDate,
      lastLineDate: row.lastLineDate,
    };
  }
  return knownFiles;
}

// A disconnected daemon (or one that can't yet answer) yields an empty scan
// rather than failing `refresh()`.
async function requestUsageScan(db: Db, state: AppState, since?: string): Promise<UsageScanDispatchResult> {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return EMPTY_SCAN;
  const knownFiles = loadKnownFiles(db);
  const sealedDates = db.select({ date: usageSealedDate.date }).from(usageSealedDate).all().map((r) => r.date);
  return dispatchUsageScan(knownFiles, sealedDates, state, since);
}

// ── Engy workspace/project resolution ─────────────────────────────────

interface EngyIds {
  workspaceId: number | null;
  projectId: number | null;
}

const UNRESOLVED_ENGY_IDS: EngyIds = { workspaceId: null, projectId: null };

// One scan carries thousands of sessions over a handful of repo roots, so the
// workspace table is read once and each root resolved at most once.
function createEngyIdResolver(db: Db): (repoRoot: string | null) => EngyIds {
  const allWorkspaces = db.select().from(workspaces).all();
  const cache = new Map<string, EngyIds>();

  return (repoRoot) => {
    if (!repoRoot) return UNRESOLVED_ENGY_IDS;
    const cached = cache.get(repoRoot);
    if (cached) return cached;

    const match = allWorkspaces.find((ws) =>
      ((ws.repos as string[] | null) ?? []).includes(repoRoot),
    );
    const resolved = match
      ? {
          workspaceId: match.id,
          projectId:
            db
              .select()
              .from(projects)
              .where(and(eq(projects.workspaceId, match.id), eq(projects.isDefault, true)))
              .get()?.id ?? null,
        }
      : UNRESOLVED_ENGY_IDS;
    cache.set(repoRoot, resolved);
    return resolved;
  };
}

// ── Upsert ────────────────────────────────────────────────────────────

function addExcluded(column: SQLiteColumn): SQL<number> {
  return sql`${column} + excluded.${sql.identifier(column.name)}`;
}

function maxExcluded(column: SQLiteColumn): SQL<number> {
  return sql`max(${column}, excluded.${sql.identifier(column.name)})`;
}

/** `min`/`max` return NULL if either side is NULL, so fall back to the other. */
function earliestExcluded(column: SQLiteColumn): SQL<string | null> {
  const excluded = sql`excluded.${sql.identifier(column.name)}`;
  return sql`min(coalesce(${column}, ${excluded}), coalesce(${excluded}, ${column}))`;
}

/** The first stored non-zero value wins, so a tail scan cannot replace the session's first call. */
function firstNonZeroExcluded(column: SQLiteColumn): SQL<number> {
  const excluded = sql`excluded.${sql.identifier(column.name)}`;
  return sql`case when ${column} > 0 then ${column} else ${excluded} end`;
}

function latestExcluded(column: SQLiteColumn): SQL<string | null> {
  const excluded = sql`excluded.${sql.identifier(column.name)}`;
  return sql`max(coalesce(${column}, ${excluded}), coalesce(${excluded}, ${column}))`;
}

/**
 * A full parse re-derives every row this session owns, and a truncated
 * transcript can leave fewer of them than before, so the old set goes first.
 */
function clearSessionRollups(tx: Db, sessionId: string): void {
  tx.delete(usageSessionDaily).where(eq(usageSessionDaily.sessionId, sessionId)).run();
  tx.delete(usageTool).where(eq(usageTool.sessionId, sessionId)).run();
  tx.delete(usageField).where(eq(usageField.sessionId, sessionId)).run();
  tx.delete(usageFile).where(eq(usageFile.sessionId, sessionId)).run();
  tx.delete(usageCause).where(eq(usageCause.sessionId, sessionId)).run();
  tx.delete(usageContextItem).where(eq(usageContextItem.sessionId, sessionId)).run();
  tx.delete(usageCall).where(eq(usageCall.sessionId, sessionId)).run();
  tx.delete(usageExpensiveCall).where(eq(usageExpensiveCall.sessionId, sessionId)).run();
}

const EXPENSIVE_CALL_LIMIT = 20;

/**
 * `usageExpensiveCall`'s key includes `priorCalls + callIndex`, which is
 * fresh on every scan pass — without pruning, a session refreshed many
 * times accumulates one row per pass instead of keeping only its overall
 * biggest calls.
 */
function pruneExpensiveCalls(tx: Db, sessionId: string): void {
  const keep = tx
    .select({ callIndex: usageExpensiveCall.callIndex })
    .from(usageExpensiveCall)
    .where(eq(usageExpensiveCall.sessionId, sessionId))
    .orderBy(desc(usageExpensiveCall.tokenTurns))
    .limit(EXPENSIVE_CALL_LIMIT)
    .all();
  if (keep.length === 0) return;
  tx.delete(usageExpensiveCall)
    .where(
      and(
        eq(usageExpensiveCall.sessionId, sessionId),
        notInArray(
          usageExpensiveCall.callIndex,
          keep.map((row) => row.callIndex),
        ),
      ),
    )
    .run();
}

function dominantFileTool(file: { reads: number; writes: number }): string {
  if (file.reads > 0) return 'Read';
  if (file.writes > 0) return 'Write';
  return 'Edit';
}

function applyScanFileUpdates(tx: Db, files: Record<string, UsageScanFileState>): void {
  const lastScanAt = new Date().toISOString();
  for (const [filePath, state] of Object.entries(files)) {
    const values = {
      sizeBytes: state.sizeBytes,
      mtimeMs: state.mtimeMs,
      bytesScanned: state.bytesScanned,
      firstLineDate: state.firstLineDate,
      lastLineDate: state.lastLineDate,
      lastScanAt,
    };
    tx.insert(usageScanFile)
      .values({ path: filePath, ...values })
      .onConflictDoUpdate({ target: usageScanFile.path, set: values })
      .run();
  }
}

// A sealed date's rollup rows are read straight from SQLite forever after.
function applySealedDates(tx: Db, dates: string[]): void {
  const sealedAt = new Date().toISOString();
  for (const dateValue of dates) {
    const values = { sealedAt, reducerVersion: USAGE_REDUCER_VERSION };
    tx.insert(usageSealedDate)
      .values({ date: dateValue, ...values })
      .onConflictDoUpdate({ target: usageSealedDate.date, set: values })
      .run();
  }
}

/**
 * A rescan of a grown transcript resumes at the stored byte offset, so its
 * rollups cover only the appended tail. Every counter therefore adds to what
 * is already stored; replacing would discard everything scanned before.
 * `isFullParse` marks the other case, where the rollups are the whole file —
 * there the session's rows are cleared first so the fresh totals stand alone.
 */
function upsertUsageScan(db: Db, response: UsageScanDispatchResult): { newSessions: number } {
  return db.transaction((tx) => {
    let newSessions = 0;
    const rates = getRatesMap(tx);
    const resolveEngyIds = createEngyIdResolver(tx);

    for (const result of response.sessions) {
      const { scan, repoRoot, meta, isFullParse } = result;
      const { session, days, tools, fields, files, causes, contextItems, calls, expensiveCalls } =
        scan;
      const existing = tx
        .select({ sessionId: usageSession.sessionId, apiCalls: usageSession.apiCalls })
        .from(usageSession)
        .where(eq(usageSession.sessionId, session.sessionId))
        .get();
      if (!existing) newSessions += 1;
      if (isFullParse) clearSessionRollups(tx, session.sessionId);
      // Tail rollups number their calls from 1 again, so they continue after
      // the calls already stored rather than overwriting them.
      const priorCalls = isFullParse ? 0 : (existing?.apiCalls ?? 0);

      const rate = rateFor(rates, session.model);
      const estCostCents = microCentsToCents(
        days.reduce((sum, day) => {
          const dayRate = rateFor(rates, day.model);
          return dayRate ? sum + microCentsForTokens(day, dayRate) : sum;
        }, 0),
      );

      const { workspaceId, projectId } = resolveEngyIds(repoRoot);

      const sessionValues = {
        slug: session.slug,
        cwd: session.cwd,
        gitBranch: session.gitBranch,
        repoRoot,
        parentSessionId: session.parentSessionId,
        isSubagent: session.isSubagent,
        agentType: session.agentType,
        agentDescription: session.agentDescription,
        engyWorkspaceId: workspaceId,
        engyProjectId: projectId,
        model: session.model,
        startedAt: session.startedAt,
        startedDate: session.startedDate,
        endedAt: session.endedAt,
        apiCalls: session.apiCalls,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        thinkingTokens: session.thinkingTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWrite1hTokens: session.cacheWrite1hTokens,
        cacheWrite5mTokens: session.cacheWrite5mTokens,
        webSearchRequests: session.webSearchRequests,
        webFetchRequests: session.webFetchRequests,
        estCostCents,
        firstPrompt: meta?.firstPrompt ?? null,
        durationMinutes: meta?.durationMinutes ?? null,
        linesAdded: meta?.linesAdded ?? null,
        linesRemoved: meta?.linesRemoved ?? null,
        filesModified: meta?.filesModified ?? null,
        gitCommits: meta?.gitCommits ?? null,
        toolErrors: meta?.toolErrors ?? null,
        compactions: scan.compactions,
        baseContextTokens: session.baseContextTokens,
      };

      const sessionSet = isFullParse
        ? sessionValues
        : {
            ...sessionValues,
            startedAt: earliestExcluded(usageSession.startedAt),
            startedDate: earliestExcluded(usageSession.startedDate),
            endedAt: latestExcluded(usageSession.endedAt),
            apiCalls: addExcluded(usageSession.apiCalls),
            inputTokens: addExcluded(usageSession.inputTokens),
            outputTokens: addExcluded(usageSession.outputTokens),
            thinkingTokens: addExcluded(usageSession.thinkingTokens),
            cacheReadTokens: addExcluded(usageSession.cacheReadTokens),
            cacheWrite1hTokens: addExcluded(usageSession.cacheWrite1hTokens),
            cacheWrite5mTokens: addExcluded(usageSession.cacheWrite5mTokens),
            webSearchRequests: addExcluded(usageSession.webSearchRequests),
            webFetchRequests: addExcluded(usageSession.webFetchRequests),
            estCostCents: addExcluded(usageSession.estCostCents),
            compactions: addExcluded(usageSession.compactions),
            baseContextTokens: firstNonZeroExcluded(usageSession.baseContextTokens),
          };

      tx.insert(usageSession)
        .values({ sessionId: session.sessionId, ...sessionValues })
        .onConflictDoUpdate({ target: usageSession.sessionId, set: sessionSet })
        .run();

      for (const day of days) {
        tx.insert(usageSessionDaily)
          .values({
            date: day.date,
            sessionId: session.sessionId,
            slug: session.slug,
            model: day.model,
            isSubagent: session.isSubagent,
            apiCalls: day.apiCalls,
            inputTokens: day.inputTokens,
            outputTokens: day.outputTokens,
            thinkingTokens: day.thinkingTokens,
            cacheReadTokens: day.cacheReadTokens,
            cacheWrite1hTokens: day.cacheWrite1hTokens,
            cacheWrite5mTokens: day.cacheWrite5mTokens,
          })
          .onConflictDoUpdate({
            target: [usageSessionDaily.date, usageSessionDaily.sessionId, usageSessionDaily.model],
            set: {
              slug: session.slug,
              isSubagent: session.isSubagent,
              apiCalls: addExcluded(usageSessionDaily.apiCalls),
              inputTokens: addExcluded(usageSessionDaily.inputTokens),
              outputTokens: addExcluded(usageSessionDaily.outputTokens),
              thinkingTokens: addExcluded(usageSessionDaily.thinkingTokens),
              cacheReadTokens: addExcluded(usageSessionDaily.cacheReadTokens),
              cacheWrite1hTokens: addExcluded(usageSessionDaily.cacheWrite1hTokens),
              cacheWrite5mTokens: addExcluded(usageSessionDaily.cacheWrite5mTokens),
            },
          })
          .run();
      }

      // Direct, unscaled: a row's cost is its own token-turns at this
      // session's cache-read rate — never inflated to fill 100% of measured
      // spend (see `causesWithBaseline` for why). Stored as micro-cents and
      // rounded once at query time — rounding here, per row, would zero most
      // of the sub-cent rows before the router ever sums them.
      const directRowMicroCents = (tokenTurns: number): number =>
        rate ? directMicroCents(tokenTurns, rate.cacheReadMicroCentsPerToken) : 0;

      for (const tool of tools) {
        tx.insert(usageTool)
          .values({
            date: tool.date,
            sessionId: session.sessionId,
            toolName: tool.tool,
            calls: tool.calls,
            resultChars: tool.resultChars,
            resultTokensEst: tool.tokens,
            inputChars: tool.inputChars,
            attributedTokenTurns: tool.tokenTurns,
            attributedCostMicroCents: directRowMicroCents(tool.tokenTurns),
            maxResultChars: tool.maxResultChars,
            p50ResultChars: tool.p50ResultChars,
            p95ResultChars: tool.p95ResultChars,
            errorCount: tool.errors,
            images: tool.images,
          })
          .onConflictDoUpdate({
            target: [usageTool.date, usageTool.sessionId, usageTool.toolName],
            set: {
              calls: addExcluded(usageTool.calls),
              resultChars: addExcluded(usageTool.resultChars),
              resultTokensEst: addExcluded(usageTool.resultTokensEst),
              inputChars: addExcluded(usageTool.inputChars),
              attributedTokenTurns: addExcluded(usageTool.attributedTokenTurns),
              attributedCostMicroCents: addExcluded(usageTool.attributedCostMicroCents),
              maxResultChars: maxExcluded(usageTool.maxResultChars),
              // A reservoir sample can't be merged across scan passes without
              // its raw draws, so a tail rescan's percentiles simply replace
              // the prior estimate rather than combining with it.
              p50ResultChars: tool.p50ResultChars,
              p95ResultChars: tool.p95ResultChars,
              errorCount: addExcluded(usageTool.errorCount),
              images: addExcluded(usageTool.images),
            },
          })
          .run();
      }

      for (const field of fields) {
        tx.insert(usageField)
          .values({
            date: field.date,
            sessionId: session.sessionId,
            tool: field.tool,
            field: field.field,
            calls: field.calls,
            tokens: field.tokens,
            tokenTurns: field.tokenTurns,
            attributedCostMicroCents: directRowMicroCents(field.tokenTurns),
          })
          .onConflictDoUpdate({
            target: [usageField.date, usageField.sessionId, usageField.tool, usageField.field],
            set: {
              calls: addExcluded(usageField.calls),
              tokens: addExcluded(usageField.tokens),
              tokenTurns: addExcluded(usageField.tokenTurns),
              attributedCostMicroCents: addExcluded(usageField.attributedCostMicroCents),
            },
          })
          .run();
      }

      for (const file of files) {
        tx.insert(usageFile)
          .values({
            date: file.date,
            sessionId: session.sessionId,
            filePath: file.filePath,
            tool: dominantFileTool(file),
            reads: file.reads,
            edits: file.edits,
            writes: file.writes,
            totalChars: file.totalChars,
            tokensEst: file.tokens,
            attributedTokenTurns: file.tokenTurns,
            attributedCostMicroCents: directRowMicroCents(file.tokenTurns),
            ext: file.ext,
          })
          .onConflictDoUpdate({
            target: [usageFile.date, usageFile.sessionId, usageFile.filePath],
            set: {
              tool: dominantFileTool(file),
              reads: addExcluded(usageFile.reads),
              edits: addExcluded(usageFile.edits),
              writes: addExcluded(usageFile.writes),
              totalChars: addExcluded(usageFile.totalChars),
              tokensEst: addExcluded(usageFile.tokensEst),
              attributedTokenTurns: addExcluded(usageFile.attributedTokenTurns),
              attributedCostMicroCents: addExcluded(usageFile.attributedCostMicroCents),
            },
          })
          .run();
      }

      for (const call of expensiveCalls) {
        const callValues = {
          tool: call.tool,
          field: call.field,
          tokens: call.tokens,
          tokenTurns: call.tokenTurns,
          attributedCostMicroCents: directRowMicroCents(call.tokenTurns),
          preview: call.preview,
        };
        tx.insert(usageExpensiveCall)
          .values({
            date: call.date,
            sessionId: session.sessionId,
            callIndex: priorCalls + call.callIndex,
            ...callValues,
          })
          .onConflictDoUpdate({
            target: [usageExpensiveCall.date, usageExpensiveCall.sessionId, usageExpensiveCall.callIndex],
            set: callValues,
          })
          .run();
      }
      pruneExpensiveCalls(tx, session.sessionId);

      for (const cause of causes) {
        tx.insert(usageCause)
          .values({
            date: cause.date,
            sessionId: session.sessionId,
            kind: cause.kind,
            tokenTurns: cause.tokenTurns,
          })
          .onConflictDoUpdate({
            target: [usageCause.date, usageCause.sessionId, usageCause.kind],
            set: { tokenTurns: addExcluded(usageCause.tokenTurns) },
          })
          .run();
      }

      for (const item of contextItems) {
        tx.insert(usageContextItem)
          .values({
            date: item.date,
            sessionId: session.sessionId,
            kind: item.kind,
            label: item.label,
            count: item.count,
            tokens: item.tokens,
            tokenTurns: item.tokenTurns,
            attributedCostMicroCents: directRowMicroCents(item.tokenTurns),
          })
          .onConflictDoUpdate({
            target: [
              usageContextItem.date,
              usageContextItem.sessionId,
              usageContextItem.kind,
              usageContextItem.label,
            ],
            set: {
              count: addExcluded(usageContextItem.count),
              tokens: addExcluded(usageContextItem.tokens),
              tokenTurns: addExcluded(usageContextItem.tokenTurns),
              attributedCostMicroCents: addExcluded(usageContextItem.attributedCostMicroCents),
            },
          })
          .run();
      }

      for (const call of calls) {
        tx.insert(usageCall)
          .values({
            sessionId: session.sessionId,
            callIndex: priorCalls + call.callIndex,
            cacheReadTokens: call.cacheReadTokens,
          })
          .onConflictDoUpdate({
            target: [usageCall.sessionId, usageCall.callIndex],
            set: { cacheReadTokens: call.cacheReadTokens },
          })
          .run();
      }
    }

    applyScanFileUpdates(tx, response.files);
    applySealedDates(tx, response.newlySealedDates);

    return { newSessions };
  });
}

// ── Refresh ───────────────────────────────────────────────────────────

interface RefreshResult {
  scannedFiles: number;
  newSessions: number;
  durationMs: number;
}

// Two clicks must not start two full scans that race on the same upsert —
// every call while one is already running shares its result instead.
let inFlightRefresh: Promise<RefreshResult> | null = null;

async function performRefresh(state: AppState, since: string | undefined): Promise<RefreshResult> {
  const db = getDb();
  const start = Date.now();
  if (invalidateStaleReducerSeals(db)) {
    console.warn('[usage] reducer version changed — cleared history for a full rebuild');
  }
  const scan = await requestUsageScan(db, state, since);
  const { newSessions } = upsertUsageScan(db, scan);
  if (scan.staleSealSkips > 0) {
    // A line landed before an already-sealed day (clock change, machine-
    // hopping) — never silently reopen the seal, just surface it.
    console.warn(`[usage] ${scan.staleSealSkips} stale seal skip(s) detected`);
  }
  const scannedFiles = Object.keys(scan.files).length;
  broadcastUsageChange(scannedFiles, newSessions);
  return { scannedFiles, newSessions, durationMs: Date.now() - start };
}

export function refreshUsage(state: AppState, since: string | undefined): Promise<RefreshResult> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = performRefresh(state, since).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

export function isUsageScanInFlight(): boolean {
  return inFlightRefresh !== null;
}
