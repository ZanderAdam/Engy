import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
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
import { USAGE_REDUCER_VERSION, hasStaleReducerSeals, rebuildUsageHistory } from './rebuild';

// ── Daemon dispatch ───────────────────────────────────────────────────

const EMPTY_SCAN: UsageScanDispatchResult = {
  sessions: [],
  files: {},
  newlySealedDates: [],
  reducerVersion: USAGE_REDUCER_VERSION,
};

function loadKnownFiles(db: Db): Record<string, UsageScanFileState> {
  const rows = db.select().from(usageScanFile).all();
  const knownFiles: Record<string, UsageScanFileState> = {};
  for (const row of rows) {
    knownFiles[row.path] = {
      sizeBytes: row.sizeBytes,
      mtimeMs: row.mtimeMs,
      firstLineDate: row.firstLineDate,
      lastLineDate: row.lastLineDate,
    };
  }
  return knownFiles;
}

// A disconnected daemon (or one that can't yet answer) yields an empty scan
// rather than failing `refresh()`.
async function requestUsageScan(
  db: Db,
  state: AppState,
  since: string | undefined,
  rebuild: boolean,
): Promise<UsageScanDispatchResult> {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return EMPTY_SCAN;
  if (rebuild) return dispatchUsageScan({}, [], state, since);
  const knownFiles = loadKnownFiles(db);
  const sealedDates = db.select({ date: usageSealedDate.date }).from(usageSealedDate).all().map((r) => r.date);
  return dispatchUsageScan(knownFiles, sealedDates, state, since);
}

// `pnpm cycle-web` restarts only the server, so an older daemon can still be
// running. Its rollups lack fields this server reads, or were computed by
// replaced logic, so they must not be stored or sealed.
function assertDaemonReducerVersion(reducerVersion: number | undefined): void {
  if (reducerVersion === USAGE_REDUCER_VERSION) return;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      `The Engy daemon runs an older usage scanner (version ${reducerVersion ?? 'unknown'}, ` +
      `server needs ${USAGE_REDUCER_VERSION}). Restart the daemon, then refresh.`,
  });
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

/**
 * A scan re-derives every row this session owns, and a truncated transcript
 * can leave fewer of them than before, so the old set goes first.
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

/** Each scanned session is a whole transcript, so its rows replace the stored ones. */
function upsertUsageScan(
  db: Db,
  response: UsageScanDispatchResult,
  rebuild: boolean,
): { newSessions: number } {
  return db.transaction((tx) => {
    if (rebuild) rebuildUsageHistory(tx);
    let newSessions = 0;
    const rates = getRatesMap(tx);
    const resolveEngyIds = createEngyIdResolver(tx);

    for (const result of response.sessions) {
      const { scan, repoRoot, meta } = result;
      const { session, days, tools, fields, files, causes, contextItems, calls, expensiveCalls } =
        scan;
      const existing = tx
        .select({ sessionId: usageSession.sessionId })
        .from(usageSession)
        .where(eq(usageSession.sessionId, session.sessionId))
        .get();
      if (!existing) newSessions += 1;
      clearSessionRollups(tx, session.sessionId);

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

      tx.insert(usageSession)
        .values({ sessionId: session.sessionId, ...sessionValues })
        .onConflictDoUpdate({ target: usageSession.sessionId, set: sessionValues })
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
          .run();
      }

      for (const call of expensiveCalls) {
        tx.insert(usageExpensiveCall)
          .values({
            date: call.date,
            sessionId: session.sessionId,
            callIndex: call.callIndex,
            tool: call.tool,
            field: call.field,
            tokens: call.tokens,
            tokenTurns: call.tokenTurns,
            attributedCostMicroCents: directRowMicroCents(call.tokenTurns),
            preview: call.preview,
          })
          .run();
      }

      for (const cause of causes) {
        tx.insert(usageCause)
          .values({
            date: cause.date,
            sessionId: session.sessionId,
            kind: cause.kind,
            tokenTurns: cause.tokenTurns,
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
          .run();
      }

      for (const call of calls) {
        tx.insert(usageCall)
          .values({
            sessionId: session.sessionId,
            callIndex: call.callIndex,
            cacheReadTokens: call.cacheReadTokens,
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
  const rebuild = hasStaleReducerSeals(db);
  const scan = await requestUsageScan(db, state, since, rebuild);
  assertDaemonReducerVersion(scan.reducerVersion);
  const { newSessions } = upsertUsageScan(db, scan, rebuild);
  if (rebuild) console.warn('[usage] reducer version changed — re-read every transcript on disk');
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
