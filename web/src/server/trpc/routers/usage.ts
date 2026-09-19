import path from 'node:path';
import { z } from 'zod';
import { and, eq, gte, lte, inArray, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { UsageCauseKind, UsageScanFileState } from '@engy/common';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import {
  usageSession,
  usageDaily,
  usageTool,
  usageField,
  usageFile,
  usageCause,
  usageCall,
  usageScanFile,
  usageSealedDate,
  workspaces,
  projects,
} from '../../db/schema';
import type { AppState, UsageScanDispatchResult } from '../context';
import { dispatchUsageScan } from '../../ws/server';
import { broadcastUsageChange } from '../../ws/broadcast';
import {
  getModelRate,
  listModelRates,
  microCentsForTokens,
  microCentsToCents,
  type ModelRateRow,
} from '../../usage/pricing';

type Database = ReturnType<typeof getDb>;
// Callers pass either the top-level db handle or a `db.transaction((tx) => ...)`
// callback's `tx` — both support the same select/insert/update surface.
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;
type UsageDailyRow = typeof usageDaily.$inferSelect;
type UsageSessionRow = typeof usageSession.$inferSelect;

const CACHE_EFFICIENCY_BREAK_EVEN = 2.2;
const LABEL_MAX_LENGTH = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

const rangeInput = z.object({
  workspaceId: z.number().optional(),
  projectId: z.number().optional(),
  from: z.string(),
  to: z.string(),
});

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
export async function requestUsageScan(db: Db, state: AppState): Promise<UsageScanDispatchResult> {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return EMPTY_SCAN;
  const knownFiles = loadKnownFiles(db);
  const sealedDates = db.select({ date: usageSealedDate.date }).from(usageSealedDate).all().map((r) => r.date);
  return dispatchUsageScan(knownFiles, sealedDates, state);
}

// ── Date helpers ──────────────────────────────────────────────────────

function dateToMs(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// A stat tile's delta compares against the immediately preceding window of
// equal length — a 30-day view compares to the 30 days before it.
function previousWindow(from: string, to: string): { from: string; to: string } {
  const lengthDays = Math.round((dateToMs(to) - dateToMs(from)) / DAY_MS) + 1;
  const prevToMs = dateToMs(from) - DAY_MS;
  const prevFromMs = prevToMs - (lengthDays - 1) * DAY_MS;
  return { from: msToDate(prevFromMs), to: msToDate(prevToMs) };
}

function startedAtInRange(startedAt: string | null, from: string, to: string): boolean {
  if (!startedAt) return false;
  const date = startedAt.slice(0, 10);
  return date >= from && date <= to;
}

// ── Scope resolution (workspace/project → session/slug sets) ────────────

interface SessionScope {
  sessionIds: Set<string>;
  slugs: Set<string>;
}

function workspaceProjectConditions(input: { workspaceId?: number; projectId?: number }): SQL[] {
  const conditions: SQL[] = [];
  if (input.workspaceId !== undefined) conditions.push(eq(usageSession.engyWorkspaceId, input.workspaceId));
  if (input.projectId !== undefined) conditions.push(eq(usageSession.engyProjectId, input.projectId));
  return conditions;
}

// Returns null when no workspace/project filter applies (query every row).
function resolveSessionScope(
  db: Db,
  input: { workspaceId?: number; projectId?: number },
): SessionScope | null {
  const conditions = workspaceProjectConditions(input);
  if (conditions.length === 0) return null;
  const rows = db
    .select({ sessionId: usageSession.sessionId, slug: usageSession.slug })
    .from(usageSession)
    .where(and(...conditions))
    .all();
  return { sessionIds: new Set(rows.map((r) => r.sessionId)), slugs: new Set(rows.map((r) => r.slug)) };
}

// ── Range-scoped row queries ──────────────────────────────────────────

function queryDailyRows(db: Db, from: string, to: string, slugs: Set<string> | null): UsageDailyRow[] {
  if (slugs && slugs.size === 0) return [];
  const conditions = [gte(usageDaily.date, from), lte(usageDaily.date, to)];
  if (slugs) conditions.push(inArray(usageDaily.slug, [...slugs]));
  return db.select().from(usageDaily).where(and(...conditions)).all();
}

function queryToolRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (sessionIds && sessionIds.size === 0) return [];
  const conditions = [gte(usageTool.date, from), lte(usageTool.date, to)];
  if (sessionIds) conditions.push(inArray(usageTool.sessionId, [...sessionIds]));
  return db.select().from(usageTool).where(and(...conditions)).all();
}

function queryFieldRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (sessionIds && sessionIds.size === 0) return [];
  const conditions = [gte(usageField.date, from), lte(usageField.date, to)];
  if (sessionIds) conditions.push(inArray(usageField.sessionId, [...sessionIds]));
  return db.select().from(usageField).where(and(...conditions)).all();
}

function queryFileRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (sessionIds && sessionIds.size === 0) return [];
  const conditions = [gte(usageFile.date, from), lte(usageFile.date, to)];
  if (sessionIds) conditions.push(inArray(usageFile.sessionId, [...sessionIds]));
  return db.select().from(usageFile).where(and(...conditions)).all();
}

function queryCauseRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (sessionIds && sessionIds.size === 0) return [];
  const conditions = [gte(usageCause.date, from), lte(usageCause.date, to)];
  if (sessionIds) conditions.push(inArray(usageCause.sessionId, [...sessionIds]));
  return db.select().from(usageCause).where(and(...conditions)).all();
}

// ── Pricing helpers ───────────────────────────────────────────────────

function getRatesMap(db: Db): Map<string, ModelRateRow> {
  return new Map(listModelRates(db).map((rate) => [rate.model, rate]));
}

// A cause's cost is its own token-turns at its session's cache-read rate —
// never scaled up to fill 100% of measured spend. Attribution now caps at
// compaction boundaries, so modeled token-turns only ever cover a fraction
// of measured cache-read cost (~0.30x on the reference machine); scaling the
// rest onto the causes we do measure would blame them for the per-call
// baseline (system prompt, tool defs, CLAUDE.md) that no content block
// carries. That gap is `causes.baseline`, computed by the caller.
function directMicroCents(tokenTurns: number, cacheReadMicroCentsPerToken: number): number {
  return tokenTurns * cacheReadMicroCentsPerToken;
}

function buildSessionModelMap(db: Db, sessionIds: Iterable<string>): Map<string, string> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ sessionId: usageSession.sessionId, model: usageSession.model })
    .from(usageSession)
    .where(inArray(usageSession.sessionId, ids))
    .all();
  return new Map(rows.map((row) => [row.sessionId, row.model]));
}

type CauseRow = { sessionId: string; kind: string; tokenTurns: number };

// Sums each cause directly, then folds the shortfall against measured
// cache-read cost into `baseline` — computed as a *cents* remainder (not an
// independently-rounded micro-cent value) so the six figures sum exactly to
// the measured total whenever attribution doesn't exceed it.
function causesWithBaseline(
  causeRows: CauseRow[],
  sessionModel: Map<string, string>,
  rates: Map<string, ModelRateRow>,
  measuredCacheReadMicroCents: number,
): Record<UsageCauseKind, number> & { baseline: number } {
  const microTotals: Record<UsageCauseKind, number> = {
    toolResult: 0,
    toolInput: 0,
    text: 0,
    image: 0,
    thinking: 0,
  };
  for (const row of causeRows) {
    const model = sessionModel.get(row.sessionId);
    const rate = model ? rates.get(model) : undefined;
    if (!rate) continue;
    microTotals[row.kind as UsageCauseKind] += directMicroCents(row.tokenTurns, rate.cacheReadMicroCentsPerToken);
  }
  const cents: Record<UsageCauseKind, number> = {
    toolResult: microCentsToCents(microTotals.toolResult),
    toolInput: microCentsToCents(microTotals.toolInput),
    text: microCentsToCents(microTotals.text),
    image: microCentsToCents(microTotals.image),
    thinking: microCentsToCents(microTotals.thinking),
  };
  const attributedCents = Object.values(cents).reduce((sum, value) => sum + value, 0);
  const baseline = Math.max(0, microCentsToCents(measuredCacheReadMicroCents) - attributedCents);
  return { ...cents, baseline };
}

function readsPerWrite(cacheReadTokens: number, cacheCreationTokens: number): number {
  return cacheCreationTokens > 0 ? cacheReadTokens / cacheCreationTokens : 0;
}

function sessionLabel(row: Pick<UsageSessionRow, 'firstPrompt' | 'sessionId'>): string {
  const trimmed = row.firstPrompt?.trim();
  if (!trimmed) return row.sessionId;
  return trimmed.length > LABEL_MAX_LENGTH ? `${trimmed.slice(0, LABEL_MAX_LENGTH - 1)}…` : trimmed;
}

// ── Engy workspace/project resolution ─────────────────────────────────

function resolveEngyIds(
  db: Db,
  repoRoot: string | null,
): { workspaceId: number | null; projectId: number | null } {
  if (!repoRoot) return { workspaceId: null, projectId: null };
  const allWorkspaces = db.select().from(workspaces).all();
  const match = allWorkspaces.find((ws) => ((ws.repos as string[] | null) ?? []).includes(repoRoot));
  if (!match) return { workspaceId: null, projectId: null };
  const defaultProject = db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, match.id), eq(projects.isDefault, true)))
    .get();
  return { workspaceId: match.id, projectId: defaultProject?.id ?? null };
}

// ── Upsert ────────────────────────────────────────────────────────────

function applyScanFileUpdates(tx: Db, files: Record<string, UsageScanFileState>): void {
  for (const [filePath, state] of Object.entries(files)) {
    const values = {
      sizeBytes: state.sizeBytes,
      mtimeMs: state.mtimeMs,
      bytesScanned: state.bytesScanned,
      firstLineDate: state.firstLineDate,
      lastLineDate: state.lastLineDate,
      lastScanAt: new Date().toISOString(),
    };
    tx.insert(usageScanFile)
      .values({ path: filePath, ...values })
      .onConflictDoUpdate({ target: usageScanFile.path, set: values })
      .run();
  }
}

// A sealed date's rollup rows are read straight from SQLite forever after —
// fileCount/rowCount are diagnostic only, never read back by any query here.
function applySealedDates(tx: Db, dates: string[]): void {
  for (const dateValue of dates) {
    const rowCount = tx.select().from(usageDaily).where(eq(usageDaily.date, dateValue)).all().length;
    const values = { sealedAt: new Date().toISOString(), fileCount: 0, rowCount, reducerVersion: 1 };
    tx.insert(usageSealedDate)
      .values({ date: dateValue, ...values })
      .onConflictDoUpdate({ target: usageSealedDate.date, set: values })
      .run();
  }
}

export function upsertUsageScan(db: Db, response: UsageScanDispatchResult): { newSessions: number } {
  return db.transaction((tx) => {
    let newSessions = 0;

    for (const result of response.sessions) {
      const { scan, repoRoot, meta } = result;
      const { session, days, tools, fields, files, causes, calls } = scan;
      const existing = tx
        .select({ sessionId: usageSession.sessionId })
        .from(usageSession)
        .where(eq(usageSession.sessionId, session.sessionId))
        .get();
      if (!existing) newSessions += 1;

      const rate = getModelRate(tx, session.model);
      const tokenBuckets = {
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheWrite1hTokens: session.cacheWrite1hTokens,
        cacheWrite5mTokens: session.cacheWrite5mTokens,
        cacheReadTokens: session.cacheReadTokens,
      };
      const estCostCents = rate ? microCentsToCents(microCentsForTokens(tokenBuckets, rate)) : 0;

      const { workspaceId, projectId } = resolveEngyIds(tx, repoRoot);

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
      };

      tx.insert(usageSession)
        .values({ sessionId: session.sessionId, ...sessionValues })
        .onConflictDoUpdate({ target: usageSession.sessionId, set: sessionValues })
        .run();

      for (const day of days) {
        const dayRate = getModelRate(tx, day.model);
        const dayCostCents = dayRate
          ? microCentsToCents(
              microCentsForTokens(
                {
                  inputTokens: day.inputTokens,
                  outputTokens: day.outputTokens,
                  cacheWrite1hTokens: day.cacheWrite1hTokens,
                  cacheWrite5mTokens: day.cacheWrite5mTokens,
                  cacheReadTokens: day.cacheReadTokens,
                },
                dayRate,
              ),
            )
          : 0;
        const dailyValues = {
          apiCalls: day.apiCalls,
          inputTokens: day.inputTokens,
          outputTokens: day.outputTokens,
          thinkingTokens: day.thinkingTokens,
          cacheReadTokens: day.cacheReadTokens,
          cacheWrite1hTokens: day.cacheWrite1hTokens,
          cacheWrite5mTokens: day.cacheWrite5mTokens,
          estCostCents: dayCostCents,
        };
        tx.insert(usageDaily)
          .values({
            date: day.date,
            slug: session.slug,
            model: day.model,
            isSubagent: session.isSubagent,
            ...dailyValues,
          })
          .onConflictDoUpdate({
            target: [usageDaily.date, usageDaily.slug, usageDaily.model, usageDaily.isSubagent],
            set: dailyValues,
          })
          .run();
      }

      // Direct, unscaled: a row's cost is its own token-turns at this
      // session's cache-read rate — never inflated to fill 100% of measured
      // spend (see `causesWithBaseline` for why).
      const directCostCents = (tokenTurns: number): number =>
        rate ? microCentsToCents(directMicroCents(tokenTurns, rate.cacheReadMicroCentsPerToken)) : 0;

      for (const tool of tools) {
        const values = {
          calls: tool.calls,
          resultChars: tool.resultChars,
          resultTokensEst: tool.tokens,
          inputChars: tool.inputChars,
          attributedTokenTurns: tool.tokenTurns,
          attributedCostCents: directCostCents(tool.tokenTurns),
          p50ResultChars: 0,
          p95ResultChars: 0,
          maxResultChars: tool.maxResultChars,
          errorCount: tool.errors,
          images: tool.images,
        };
        tx.insert(usageTool)
          .values({ date: tool.date, sessionId: session.sessionId, toolName: tool.tool, ...values })
          .onConflictDoUpdate({
            target: [usageTool.date, usageTool.sessionId, usageTool.toolName],
            set: values,
          })
          .run();
      }

      for (const field of fields) {
        const values = {
          tokens: field.tokens,
          tokenTurns: field.tokenTurns,
          attributedCostCents: directCostCents(field.tokenTurns),
        };
        tx.insert(usageField)
          .values({ date: field.date, sessionId: session.sessionId, tool: field.tool, field: field.field, ...values })
          .onConflictDoUpdate({
            target: [usageField.date, usageField.sessionId, usageField.tool, usageField.field],
            set: values,
          })
          .run();
      }

      for (const file of files) {
        const values = {
          tool: file.reads > 0 ? 'Read' : file.writes > 0 ? 'Write' : 'Edit',
          reads: file.reads,
          edits: file.edits,
          writes: file.writes,
          totalChars: 0,
          tokensEst: file.tokens,
          attributedTokenTurns: file.tokenTurns,
          attributedCostCents: directCostCents(file.tokenTurns),
          ext: file.ext,
        };
        tx.insert(usageFile)
          .values({ date: file.date, sessionId: session.sessionId, filePath: file.filePath, ...values })
          .onConflictDoUpdate({
            target: [usageFile.date, usageFile.sessionId, usageFile.filePath],
            set: values,
          })
          .run();
      }

      for (const cause of causes) {
        const values = { tokenTurns: cause.tokenTurns };
        tx.insert(usageCause)
          .values({ date: cause.date, sessionId: session.sessionId, kind: cause.kind, ...values })
          .onConflictDoUpdate({
            target: [usageCause.date, usageCause.sessionId, usageCause.kind],
            set: values,
          })
          .run();
      }

      for (const call of calls) {
        tx.insert(usageCall)
          .values({ sessionId: session.sessionId, callIndex: call.callIndex, cacheReadTokens: call.cacheReadTokens })
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

// ── Router ────────────────────────────────────────────────────────────

export const usageRouter = router({
  overview: publicProcedure
    .input(rangeInput.extend({ groupBy: z.enum(['repo', 'slug']).default('repo') }))
    .query(({ input }) => {
      const db = getDb();
      const scope = resolveSessionScope(db, input);
      const rates = getRatesMap(db);

      const dailyRows = queryDailyRows(db, input.from, input.to, scope?.slugs ?? null);
      const causeRows = queryCauseRows(db, input.from, input.to, scope?.sessionIds ?? null);

      const slugMetaConditions = workspaceProjectConditions(input);
      const slugMeta =
        slugMetaConditions.length > 0
          ? db
              .select({ slug: usageSession.slug, repoRoot: usageSession.repoRoot })
              .from(usageSession)
              .where(and(...slugMetaConditions))
              .all()
          : db.select({ slug: usageSession.slug, repoRoot: usageSession.repoRoot }).from(usageSession).all();
      const slugToRepoRoot = new Map<string, string | null>();
      for (const row of slugMeta) {
        if (!slugToRepoRoot.has(row.slug) || (!slugToRepoRoot.get(row.slug) && row.repoRoot)) {
          slugToRepoRoot.set(row.slug, row.repoRoot);
        }
      }
      const groupKeyFor = (slug: string): string =>
        input.groupBy === 'slug' ? slug : slugToRepoRoot.get(slug) || slug;

      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheWrite1hTokens: 0,
        cacheWrite5mTokens: 0,
        apiCalls: 0,
        sessions: 0,
      };
      let costInputMicro = 0;
      let costOutputMicro = 0;
      let costCacheWriteMicro = 0;
      let costCacheReadMicro = 0;
      let subagentCostMicro = 0;
      const unpricedModels = new Set<string>();
      const seriesAgg = new Map<string, { input: number; output: number; cacheWrite: number; cacheRead: number }>();
      const groupAgg = new Map<string, { costMicro: number; cacheReadTokens: number }>();

      for (const row of dailyRows) {
        totals.inputTokens += row.inputTokens;
        totals.outputTokens += row.outputTokens;
        totals.thinkingTokens += row.thinkingTokens;
        totals.cacheReadTokens += row.cacheReadTokens;
        totals.cacheWrite1hTokens += row.cacheWrite1hTokens;
        totals.cacheWrite5mTokens += row.cacheWrite5mTokens;
        totals.apiCalls += row.apiCalls;

        const rate = rates.get(row.model);
        const groupKey = groupKeyFor(row.slug);
        const group = groupAgg.get(groupKey) ?? { costMicro: 0, cacheReadTokens: 0 };
        group.cacheReadTokens += row.cacheReadTokens;

        if (!rate) {
          unpricedModels.add(row.model);
          groupAgg.set(groupKey, group);
          continue;
        }

        const inputMicro = row.inputTokens * rate.inputMicroCentsPerToken;
        const outputMicro = row.outputTokens * rate.outputMicroCentsPerToken;
        const cacheWriteMicro =
          row.cacheWrite1hTokens * rate.cacheWrite1hMicroCentsPerToken +
          row.cacheWrite5mTokens * rate.cacheWrite5mMicroCentsPerToken;
        const cacheReadMicro = row.cacheReadTokens * rate.cacheReadMicroCentsPerToken;
        const rowMicro = inputMicro + outputMicro + cacheWriteMicro + cacheReadMicro;

        costInputMicro += inputMicro;
        costOutputMicro += outputMicro;
        costCacheWriteMicro += cacheWriteMicro;
        costCacheReadMicro += cacheReadMicro;
        if (row.isSubagent) subagentCostMicro += rowMicro;

        group.costMicro += rowMicro;
        groupAgg.set(groupKey, group);

        const series = seriesAgg.get(row.date) ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
        series.input += inputMicro;
        series.output += outputMicro;
        series.cacheWrite += cacheWriteMicro;
        series.cacheRead += cacheReadMicro;
        seriesAgg.set(row.date, series);
      }

      const totalMicro = costInputMicro + costOutputMicro + costCacheWriteMicro + costCacheReadMicro;

      const sessionConditions = [...workspaceProjectConditions(input), eq(usageSession.isSubagent, false)];
      const mainSessionRows = db
        .select({ sessionId: usageSession.sessionId, startedAt: usageSession.startedAt, slug: usageSession.slug })
        .from(usageSession)
        .where(and(...sessionConditions))
        .all();
      const groupSessionCounts = new Map<string, number>();
      for (const row of mainSessionRows) {
        if (!startedAtInRange(row.startedAt, input.from, input.to)) continue;
        totals.sessions += 1;
        const key = groupKeyFor(row.slug);
        groupSessionCounts.set(key, (groupSessionCounts.get(key) ?? 0) + 1);
      }

      const causeSessionModel = buildSessionModelMap(db, causeRows.map((row) => row.sessionId));
      const causes = causesWithBaseline(causeRows, causeSessionModel, rates, costCacheReadMicro);

      const previous = previousWindow(input.from, input.to);
      const previousDailyRows = queryDailyRows(db, previous.from, previous.to, scope?.slugs ?? null);
      let previousInputMicro = 0;
      let previousOutputMicro = 0;
      let previousCacheWriteMicro = 0;
      let previousCacheReadMicro = 0;
      for (const row of previousDailyRows) {
        const rate = rates.get(row.model);
        if (!rate) continue;
        previousInputMicro += row.inputTokens * rate.inputMicroCentsPerToken;
        previousOutputMicro += row.outputTokens * rate.outputMicroCentsPerToken;
        previousCacheWriteMicro +=
          row.cacheWrite1hTokens * rate.cacheWrite1hMicroCentsPerToken +
          row.cacheWrite5mTokens * rate.cacheWrite5mMicroCentsPerToken;
        previousCacheReadMicro += row.cacheReadTokens * rate.cacheReadMicroCentsPerToken;
      }
      const previousTotalMicro =
        previousInputMicro + previousOutputMicro + previousCacheWriteMicro + previousCacheReadMicro;

      return {
        totals,
        cost: {
          input: microCentsToCents(costInputMicro),
          output: microCentsToCents(costOutputMicro),
          cacheWrite: microCentsToCents(costCacheWriteMicro),
          cacheRead: microCentsToCents(costCacheReadMicro),
          total: microCentsToCents(totalMicro),
          subagentCost: microCentsToCents(subagentCostMicro),
        },
        subagentShare: totalMicro > 0 ? subagentCostMicro / totalMicro : 0,
        previous: {
          total: microCentsToCents(previousTotalMicro),
          input: microCentsToCents(previousInputMicro),
          output: microCentsToCents(previousOutputMicro),
          cacheWrite: microCentsToCents(previousCacheWriteMicro),
          cacheRead: microCentsToCents(previousCacheReadMicro),
        },
        series: [...seriesAgg.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, bucket]) => ({
            date,
            input: microCentsToCents(bucket.input),
            output: microCentsToCents(bucket.output),
            cacheWrite: microCentsToCents(bucket.cacheWrite),
            cacheRead: microCentsToCents(bucket.cacheRead),
          })),
        groups: [...groupAgg.entries()]
          .map(([key, agg]) => ({
            key,
            label: key,
            cost: microCentsToCents(agg.costMicro),
            cacheReadTokens: agg.cacheReadTokens,
            sessions: groupSessionCounts.get(key) ?? 0,
          }))
          .sort((a, b) => b.cost - a.cost),
        causes,
        cacheEfficiency: {
          readsPerWrite: readsPerWrite(totals.cacheReadTokens, totals.cacheWrite1hTokens + totals.cacheWrite5mTokens),
          breakEven: CACHE_EFFICIENCY_BREAK_EVEN,
        },
        unpricedModels: [...unpricedModels],
      };
    }),

  tools: publicProcedure
    .input(rangeInput.extend({ limit: z.number().default(20) }))
    .query(({ input }) => {
      const db = getDb();
      const scope = resolveSessionScope(db, input);
      const rows = queryToolRows(db, input.from, input.to, scope?.sessionIds ?? null);

      const byTool = new Map<
        string,
        { calls: number; costCents: number; resultTokens: number; maxResultChars: number; images: number; errors: number }
      >();
      for (const row of rows) {
        const agg = byTool.get(row.toolName) ?? {
          calls: 0,
          costCents: 0,
          resultTokens: 0,
          maxResultChars: 0,
          images: 0,
          errors: 0,
        };
        agg.calls += row.calls;
        agg.costCents += row.attributedCostCents;
        agg.resultTokens += row.resultTokensEst;
        agg.maxResultChars = Math.max(agg.maxResultChars, row.maxResultChars);
        agg.images += row.images;
        agg.errors += row.errorCount;
        byTool.set(row.toolName, agg);
      }

      return [...byTool.entries()]
        .map(([tool, agg]) => ({
          tool,
          calls: agg.calls,
          costCents: agg.costCents,
          costPerCallCents: agg.calls > 0 ? Math.round(agg.costCents / agg.calls) : 0,
          resultTokens: agg.resultTokens,
          maxResultChars: agg.maxResultChars,
          images: agg.images,
          errors: agg.errors,
        }))
        .sort((a, b) => b.costCents - a.costCents)
        .slice(0, input.limit);
    }),

  fields: publicProcedure
    .input(rangeInput.extend({ limit: z.number().default(20) }))
    .query(({ input }) => {
      const db = getDb();
      const scope = resolveSessionScope(db, input);
      const rows = queryFieldRows(db, input.from, input.to, scope?.sessionIds ?? null);

      const byField = new Map<string, { tool: string; field: string; tokens: number; costCents: number }>();
      for (const row of rows) {
        const key = `${row.tool}\u0000${row.field}`;
        const agg = byField.get(key) ?? { tool: row.tool, field: row.field, tokens: 0, costCents: 0 };
        agg.tokens += row.tokens;
        agg.costCents += row.attributedCostCents;
        byField.set(key, agg);
      }

      return [...byField.values()]
        .sort((a, b) => b.costCents - a.costCents)
        .slice(0, input.limit);
    }),

  files: publicProcedure
    .input(rangeInput.extend({ limit: z.number().default(20), groupBy: z.enum(['path', 'ext', 'dir']).default('path') }))
    .query(({ input }) => {
      const db = getDb();
      const scope = resolveSessionScope(db, input);
      const rows = queryFileRows(db, input.from, input.to, scope?.sessionIds ?? null);

      const keyFor = (filePath: string, ext: string): string => {
        switch (input.groupBy) {
          case 'ext':
            return ext || '(none)';
          case 'dir':
            return path.dirname(filePath);
          default:
            return filePath;
        }
      };

      const byKey = new Map<string, { reads: number; edits: number; writes: number; tokens: number; costCents: number }>();
      for (const row of rows) {
        const key = keyFor(row.filePath, row.ext);
        const agg = byKey.get(key) ?? { reads: 0, edits: 0, writes: 0, tokens: 0, costCents: 0 };
        agg.reads += row.reads;
        agg.edits += row.edits;
        agg.writes += row.writes;
        agg.tokens += row.tokensEst;
        agg.costCents += row.attributedCostCents;
        byKey.set(key, agg);
      }

      return [...byKey.entries()]
        .map(([key, agg]) => ({ key, ...agg }))
        .sort((a, b) => b.costCents - a.costCents)
        .slice(0, input.limit);
    }),

  sessions: publicProcedure
    .input(
      rangeInput.extend({
        limit: z.number().default(50),
        sort: z.enum(['cost', 'calls', 'recent']).default('cost'),
        includeSubagents: z.boolean().default(false),
      }),
    )
    .query(({ input }) => {
      const db = getDb();
      const conditions = workspaceProjectConditions(input);
      const allRows =
        conditions.length > 0
          ? db.select().from(usageSession).where(and(...conditions)).all()
          : db.select().from(usageSession).all();

      const byId = new Map(allRows.map((row) => [row.sessionId, row]));
      const childrenByParent = new Map<string, UsageSessionRow[]>();
      for (const row of allRows) {
        if (row.isSubagent && row.parentSessionId) {
          const list = childrenByParent.get(row.parentSessionId) ?? [];
          list.push(row);
          childrenByParent.set(row.parentSessionId, list);
        }
      }
      const isOrphan = (row: UsageSessionRow): boolean =>
        row.isSubagent && (!row.parentSessionId || !byId.has(row.parentSessionId));

      const toSessionRow = (row: UsageSessionRow, subagentCostCents: number, subagentCalls: number) => ({
        sessionId: row.sessionId,
        slug: row.slug,
        repoRoot: row.repoRoot,
        label: sessionLabel(row),
        model: row.model,
        startedAt: row.startedAt,
        apiCalls: row.apiCalls,
        costCents: row.estCostCents + subagentCostCents,
        subagentCostCents,
        subagentCalls,
        isSubagent: row.isSubagent,
        parentSessionId: row.parentSessionId,
        readsPerWrite: readsPerWrite(row.cacheReadTokens, row.cacheWrite1hTokens + row.cacheWrite5mTokens),
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        durationMinutes: row.durationMinutes,
      });

      const topLevel = allRows.filter((row) => (!row.isSubagent || isOrphan(row)) && startedAtInRange(row.startedAt, input.from, input.to));
      const rows = topLevel.map((row) => {
        const children = row.isSubagent ? [] : childrenByParent.get(row.sessionId) ?? [];
        const subagentCostCents = children.reduce((sum, child) => sum + child.estCostCents, 0);
        const subagentCalls = children.reduce((sum, child) => sum + child.apiCalls, 0);
        return toSessionRow(row, subagentCostCents, subagentCalls);
      });

      if (input.includeSubagents) {
        const nonOrphanChildren = allRows.filter(
          (row) => row.isSubagent && !isOrphan(row) && startedAtInRange(row.startedAt, input.from, input.to),
        );
        for (const child of nonOrphanChildren) {
          rows.push(toSessionRow(child, 0, 0));
        }
      }

      switch (input.sort) {
        case 'calls':
          rows.sort((a, b) => b.apiCalls - a.apiCalls);
          break;
        case 'recent':
          rows.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
          break;
        default:
          rows.sort((a, b) => b.costCents - a.costCents);
      }

      return rows.slice(0, input.limit);
    }),

  session: publicProcedure.input(z.object({ sessionId: z.string() })).query(({ input }) => {
    const db = getDb();
    const row = db.select().from(usageSession).where(eq(usageSession.sessionId, input.sessionId)).get();
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Usage session ${input.sessionId} not found` });
    }

    const children = db
      .select()
      .from(usageSession)
      .where(eq(usageSession.parentSessionId, input.sessionId))
      .all();
    const subagentCostCents = children.reduce((sum, child) => sum + child.estCostCents, 0);
    const subagentCalls = children.reduce((sum, child) => sum + child.apiCalls, 0);

    const session = {
      sessionId: row.sessionId,
      slug: row.slug,
      repoRoot: row.repoRoot,
      label: sessionLabel(row),
      model: row.model,
      startedAt: row.startedAt,
      apiCalls: row.apiCalls,
      costCents: row.estCostCents + subagentCostCents,
      subagentCostCents,
      subagentCalls,
      isSubagent: row.isSubagent,
      parentSessionId: row.parentSessionId,
      readsPerWrite: readsPerWrite(row.cacheReadTokens, row.cacheWrite1hTokens + row.cacheWrite5mTokens),
      linesAdded: row.linesAdded,
      linesRemoved: row.linesRemoved,
      durationMinutes: row.durationMinutes,
      compactions: row.compactions,
    };

    const subagents = children.map((child) => ({
      sessionId: child.sessionId,
      agentType: child.agentType,
      agentDescription: child.agentDescription,
      model: child.model,
      apiCalls: child.apiCalls,
      costCents: child.estCostCents,
    }));

    const toolRows = db.select().from(usageTool).where(eq(usageTool.sessionId, input.sessionId)).all();
    const tools = toolRows.map((tool) => ({
      tool: tool.toolName,
      calls: tool.calls,
      costCents: tool.attributedCostCents,
      costPerCallCents: tool.calls > 0 ? Math.round(tool.attributedCostCents / tool.calls) : 0,
      resultTokens: tool.resultTokensEst,
      maxResultChars: tool.maxResultChars,
      images: tool.images,
      errors: tool.errorCount,
    }));

    const fileRows = db.select().from(usageFile).where(eq(usageFile.sessionId, input.sessionId)).all();
    const files = fileRows.map((file) => ({
      key: file.filePath,
      reads: file.reads,
      edits: file.edits,
      writes: file.writes,
      tokens: file.tokensEst,
      costCents: file.attributedCostCents,
    }));

    const fieldRows = db.select().from(usageField).where(eq(usageField.sessionId, input.sessionId)).all();
    const fields = fieldRows.map((field) => ({
      tool: field.tool,
      field: field.field,
      costCents: field.attributedCostCents,
      tokens: field.tokens,
    }));

    const callRows = db
      .select()
      .from(usageCall)
      .where(eq(usageCall.sessionId, input.sessionId))
      .orderBy(usageCall.callIndex)
      .all();
    const callSeries = callRows.map((call) => ({ callIndex: call.callIndex, cacheReadTokens: call.cacheReadTokens }));

    return { session, tools, files, fields, callSeries, subagents };
  }),

  refresh: publicProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const start = Date.now();
    const scan = await requestUsageScan(db, ctx.state);
    const { newSessions } = upsertUsageScan(db, scan);
    if (scan.staleSealSkips > 0) {
      // A line landed before an already-sealed day (clock change, machine-
      // hopping) — never silently reopen the seal, just surface it.
      console.warn(`[usage] ${scan.staleSealSkips} stale seal skip(s) detected`);
    }
    const scannedFiles = Object.keys(scan.files).length;
    broadcastUsageChange(scannedFiles, newSessions);
    return { scannedFiles, newSessions, durationMs: Date.now() - start };
  }),
});
