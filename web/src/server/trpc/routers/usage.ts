import path from 'node:path';
import { z } from 'zod';
import { and, desc, eq, gte, lte, inArray, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { TRPCError } from '@trpc/server';
import type { UsageCauseKind } from '@engy/common';
import { router, publicProcedure } from '../trpc';
import { getDb, type Db } from '../../db/client';
import {
  usageSession,
  usageSessionDaily,
  usageTool,
  usageField,
  usageFile,
  usageCause,
  usageCall,
  usageExpensiveCall,
} from '../../db/schema';
import {
  directMicroCents,
  getRatesMap,
  microCentsToCents,
  rateFor,
  type ModelRateRow,
} from '../../usage/pricing';
import { rebuildUsageHistory } from '../../usage/rebuild';
import { refreshUsage, isUsageScanInFlight } from '../../usage/ingest';
import { broadcastUsageChange } from '../../ws/broadcast';

type UsageSessionDailyRow = typeof usageSessionDaily.$inferSelect;
type UsageSessionRow = typeof usageSession.$inferSelect;

const LABEL_MAX_LENGTH = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD.');

const rangeInput = z.object({
  workspaceId: z.number().optional(),
  projectId: z.number().optional(),
  from: isoDate,
  to: isoDate,
});

// Every procedure extends `rangeInput` first, then applies this refinement —
// `.refine()` on the base schema would turn it into a `ZodEffects`, which no
// longer has `.extend()`.
function requireValidRange<T extends { from: string; to: string }>(schema: z.ZodType<T>) {
  return schema.refine((data) => data.from <= data.to, {
    message: 'The start date must be on or before the end date.',
    path: ['to'],
  });
}

const refreshInput = z.object({ since: isoDate.optional() }).optional();

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

// `startedDate` is the daemon's local calendar date for the session's start;
// falling back to slicing `startedAt` (UTC) only covers rows scanned before
// the daemon started reporting it.
function startedDateInRange(
  row: { startedAt: string | null; startedDate: string | null },
  from: string,
  to: string,
): boolean {
  const date = row.startedDate ?? (row.startedAt ? row.startedAt.slice(0, 10) : null);
  if (!date) return false;
  return date >= from && date <= to;
}

// ── Scope resolution (workspace/project → session ids) ────────────────

function workspaceProjectConditions(input: { workspaceId?: number; projectId?: number }): SQL[] {
  const conditions: SQL[] = [];
  if (input.workspaceId !== undefined) conditions.push(eq(usageSession.engyWorkspaceId, input.workspaceId));
  if (input.projectId !== undefined) conditions.push(eq(usageSession.engyProjectId, input.projectId));
  return conditions;
}

// Returns null when no workspace/project filter applies (query every row).
function resolveScopedSessionIds(
  db: Db,
  input: { workspaceId?: number; projectId?: number },
): Set<string> | null {
  const conditions = workspaceProjectConditions(input);
  if (conditions.length === 0) return null;
  const rows = db
    .select({ sessionId: usageSession.sessionId })
    .from(usageSession)
    .where(and(...conditions))
    .all();
  return new Set(rows.map((r) => r.sessionId));
}

// ── Range-scoped row queries ──────────────────────────────────────────

/**
 * Every rollup table is keyed by `(date, sessionId, …)`, so one filter serves
 * them all. Scoping by `sessionId` — never by `slug` — is what keeps each
 * table's rows over the same sessions: two repos can share a slug, and two
 * sessions in one repo can differ in workspace.
 */
type RollupTable = { date: SQLiteColumn; sessionId: SQLiteColumn };

function rangeConditions(
  table: RollupTable,
  from: string,
  to: string,
  sessionIds: Set<string> | null,
): SQL[] {
  const conditions = [gte(table.date, from), lte(table.date, to)];
  if (sessionIds) conditions.push(inArray(table.sessionId, [...sessionIds]));
  return conditions;
}

function isEmptyScope(sessionIds: Set<string> | null): boolean {
  return sessionIds !== null && sessionIds.size === 0;
}

function queryDailyRows(
  db: Db,
  from: string,
  to: string,
  sessionIds: Set<string> | null,
): UsageSessionDailyRow[] {
  if (isEmptyScope(sessionIds)) return [];
  const where = and(...rangeConditions(usageSessionDaily, from, to, sessionIds));
  return db.select().from(usageSessionDaily).where(where).all();
}

function queryToolRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (isEmptyScope(sessionIds)) return [];
  const where = and(...rangeConditions(usageTool, from, to, sessionIds));
  return db.select().from(usageTool).where(where).all();
}

function queryFieldRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (isEmptyScope(sessionIds)) return [];
  const where = and(...rangeConditions(usageField, from, to, sessionIds));
  return db.select().from(usageField).where(where).all();
}

function queryFileRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (isEmptyScope(sessionIds)) return [];
  const where = and(...rangeConditions(usageFile, from, to, sessionIds));
  return db.select().from(usageFile).where(where).all();
}

function summarizeTools(rows: Array<typeof usageTool.$inferSelect>) {
  const byTool = new Map<
    string,
    {
      calls: number;
      costMicroCents: number;
      resultTokens: number;
      maxResultChars: number;
      // p50/p95 are call-weighted across a tool's (date, session) rows —
      // an approximation, since a true cross-row percentile would need
      // every row's raw sample, which the reducer never stores.
      p50Weighted: number;
      p95Max: number;
      images: number;
      errors: number;
    }
  >();
  for (const row of rows) {
    const agg = byTool.get(row.toolName) ?? {
      calls: 0,
      costMicroCents: 0,
      resultTokens: 0,
      maxResultChars: 0,
      p50Weighted: 0,
      p95Max: 0,
      images: 0,
      errors: 0,
    };
    agg.calls += row.calls;
    agg.costMicroCents += row.attributedCostMicroCents;
    agg.resultTokens += row.resultTokensEst;
    agg.maxResultChars = Math.max(agg.maxResultChars, row.maxResultChars);
    agg.p50Weighted += row.p50ResultChars * row.calls;
    agg.p95Max = Math.max(agg.p95Max, row.p95ResultChars);
    agg.images += row.images;
    agg.errors += row.errorCount;
    byTool.set(row.toolName, agg);
  }

  return [...byTool.entries()]
    .map(([tool, agg]) => {
      const costCents = microCentsToCents(agg.costMicroCents);
      return {
        tool,
        calls: agg.calls,
        costCents,
        costPerCallCents: agg.calls > 0 ? Math.round(costCents / agg.calls) : 0,
        resultTokens: agg.resultTokens,
        maxResultChars: agg.maxResultChars,
        p50ResultChars: agg.calls > 0 ? Math.round(agg.p50Weighted / agg.calls) : 0,
        p95ResultChars: agg.p95Max,
        images: agg.images,
        errors: agg.errors,
      };
    })
    .sort((a, b) => b.costCents - a.costCents);
}

function summarizeFields(rows: Array<typeof usageField.$inferSelect>) {
  const byField = new Map<
    string,
    { tool: string; field: string; calls: number; tokens: number; costMicroCents: number }
  >();
  for (const row of rows) {
    const key = `${row.tool}\u0000${row.field}`;
    const agg = byField.get(key) ?? {
      tool: row.tool,
      field: row.field,
      calls: 0,
      tokens: 0,
      costMicroCents: 0,
    };
    agg.calls += row.calls;
    agg.tokens += row.tokens;
    agg.costMicroCents += row.attributedCostMicroCents;
    byField.set(key, agg);
  }

  return [...byField.values()]
    .map(({ tool, field, calls, tokens, costMicroCents }) => ({
      tool,
      field,
      calls,
      tokens,
      costCents: microCentsToCents(costMicroCents),
    }))
    .sort((a, b) => b.costCents - a.costCents);
}

function summarizeFiles(
  rows: Array<typeof usageFile.$inferSelect>,
  groupBy: 'path' | 'ext' | 'dir',
) {
  const keyFor = (filePath: string, ext: string): string => {
    switch (groupBy) {
      case 'ext':
        return ext || '(none)';
      case 'dir':
        return path.dirname(filePath);
      default:
        return filePath;
    }
  };

  const byKey = new Map<
    string,
    {
      reads: number;
      edits: number;
      writes: number;
      totalChars: number;
      tokens: number;
      costMicroCents: number;
    }
  >();
  for (const row of rows) {
    const key = keyFor(row.filePath, row.ext);
    const agg = byKey.get(key) ?? {
      reads: 0,
      edits: 0,
      writes: 0,
      totalChars: 0,
      tokens: 0,
      costMicroCents: 0,
    };
    agg.reads += row.reads;
    agg.edits += row.edits;
    agg.writes += row.writes;
    agg.totalChars += row.totalChars;
    agg.tokens += row.tokensEst;
    agg.costMicroCents += row.attributedCostMicroCents;
    byKey.set(key, agg);
  }

  return [...byKey.entries()]
    .map(([key, agg]) => ({
      key,
      reads: agg.reads,
      edits: agg.edits,
      writes: agg.writes,
      totalChars: agg.totalChars,
      tokens: agg.tokens,
      costCents: microCentsToCents(agg.costMicroCents),
    }))
    .sort((a, b) => b.costCents - a.costCents);
}

function queryCauseRows(db: Db, from: string, to: string, sessionIds: Set<string> | null) {
  if (isEmptyScope(sessionIds)) return [];
  const where = and(...rangeConditions(usageCause, from, to, sessionIds));
  return db.select().from(usageCause).where(where).all();
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

// ── Daily-row pricing ─────────────────────────────────────────────────

interface CostSplitMicro {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

function emptyCostSplit(): CostSplitMicro {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function rowCostMicro(row: UsageSessionDailyRow, rate: ModelRateRow): CostSplitMicro {
  return {
    input: row.inputTokens * rate.inputMicroCentsPerToken,
    output: row.outputTokens * rate.outputMicroCentsPerToken,
    cacheWrite:
      row.cacheWrite1hTokens * rate.cacheWrite1hMicroCentsPerToken +
      row.cacheWrite5mTokens * rate.cacheWrite5mMicroCentsPerToken,
    cacheRead: row.cacheReadTokens * rate.cacheReadMicroCentsPerToken,
  };
}

function addCostSplit(target: CostSplitMicro, cost: CostSplitMicro): void {
  target.input += cost.input;
  target.output += cost.output;
  target.cacheWrite += cost.cacheWrite;
  target.cacheRead += cost.cacheRead;
}

function totalCostMicro(cost: CostSplitMicro): number {
  return cost.input + cost.output + cost.cacheWrite + cost.cacheRead;
}

// The previous window's delta must be priced exactly like the current one,
// or the tile reports a change that is an artefact of the two code paths.
function sumCostMicro(rows: UsageSessionDailyRow[], rates: Map<string, ModelRateRow>): CostSplitMicro {
  const total = emptyCostSplit();
  for (const row of rows) {
    const rate = rateFor(rates, row.model);
    if (rate) addCostSplit(total, rowCostMicro(row, rate));
  }
  return total;
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
    if (!(row.kind in microTotals)) continue;
    const model = sessionModel.get(row.sessionId);
    const rate = model ? rateFor(rates, model) : undefined;
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

function hasBilledTokens(row: UsageSessionDailyRow): boolean {
  const billedTokens =
    row.inputTokens +
    row.outputTokens +
    row.cacheReadTokens +
    row.cacheWrite1hTokens +
    row.cacheWrite5mTokens;
  return billedTokens > 0;
}

function readsPerWrite(cacheReadTokens: number, cacheCreationTokens: number): number {
  return cacheCreationTokens > 0 ? cacheReadTokens / cacheCreationTokens : 0;
}

function toSessionRow(row: UsageSessionRow, subagentCostCents: number, subagentCalls: number) {
  return {
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
  };
}

function sessionLabel(row: Pick<UsageSessionRow, 'firstPrompt' | 'sessionId'>): string {
  const trimmed = row.firstPrompt?.trim();
  if (!trimmed) return row.sessionId;
  return trimmed.length > LABEL_MAX_LENGTH ? `${trimmed.slice(0, LABEL_MAX_LENGTH - 1)}…` : trimmed;
}

// ── Router ────────────────────────────────────────────────────────────

export const usageRouter = router({
  overview: publicProcedure
    .input(requireValidRange(rangeInput.extend({ groupBy: z.enum(['repo', 'slug']).default('repo') })))
    .query(({ input }) => {
      const db = getDb();
      const sessionIds = resolveScopedSessionIds(db, input);
      const rates = getRatesMap(db);

      const dailyRows = queryDailyRows(db, input.from, input.to, sessionIds);
      const causeRows = queryCauseRows(db, input.from, input.to, sessionIds);

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
      const costMicro = emptyCostSplit();
      let subagentCostMicro = 0;
      const unpricedModels = new Set<string>();
      const seriesAgg = new Map<string, CostSplitMicro>();
      const groupAgg = new Map<string, { costMicro: number; cacheReadTokens: number }>();

      for (const row of dailyRows) {
        totals.inputTokens += row.inputTokens;
        totals.outputTokens += row.outputTokens;
        totals.thinkingTokens += row.thinkingTokens;
        totals.cacheReadTokens += row.cacheReadTokens;
        totals.cacheWrite1hTokens += row.cacheWrite1hTokens;
        totals.cacheWrite5mTokens += row.cacheWrite5mTokens;
        totals.apiCalls += row.apiCalls;

        const rate = rateFor(rates, row.model);
        const groupKey = groupKeyFor(row.slug);
        const group = groupAgg.get(groupKey) ?? { costMicro: 0, cacheReadTokens: 0 };
        group.cacheReadTokens += row.cacheReadTokens;

        if (!rate) {
          if (hasBilledTokens(row)) unpricedModels.add(row.model);
          groupAgg.set(groupKey, group);
          continue;
        }

        const rowCost = rowCostMicro(row, rate);
        const rowMicro = totalCostMicro(rowCost);

        addCostSplit(costMicro, rowCost);
        if (row.isSubagent) subagentCostMicro += rowMicro;

        group.costMicro += rowMicro;
        groupAgg.set(groupKey, group);

        const series = seriesAgg.get(row.date) ?? emptyCostSplit();
        addCostSplit(series, rowCost);
        seriesAgg.set(row.date, series);
      }

      const totalMicro = totalCostMicro(costMicro);

      const sessionConditions = [...workspaceProjectConditions(input), eq(usageSession.isSubagent, false)];
      const mainSessionRows = db
        .select({
          sessionId: usageSession.sessionId,
          startedAt: usageSession.startedAt,
          startedDate: usageSession.startedDate,
          slug: usageSession.slug,
        })
        .from(usageSession)
        .where(and(...sessionConditions))
        .all();
      const groupSessionCounts = new Map<string, number>();
      for (const row of mainSessionRows) {
        if (!startedDateInRange(row, input.from, input.to)) continue;
        totals.sessions += 1;
        const key = groupKeyFor(row.slug);
        groupSessionCounts.set(key, (groupSessionCounts.get(key) ?? 0) + 1);
      }

      const causeSessionModel = buildSessionModelMap(db, causeRows.map((row) => row.sessionId));
      const causes = causesWithBaseline(causeRows, causeSessionModel, rates, costMicro.cacheRead);

      const previous = previousWindow(input.from, input.to);
      const previousCostMicro = sumCostMicro(
        queryDailyRows(db, previous.from, previous.to, sessionIds),
        rates,
      );

      return {
        totals,
        cost: {
          input: microCentsToCents(costMicro.input),
          output: microCentsToCents(costMicro.output),
          cacheWrite: microCentsToCents(costMicro.cacheWrite),
          cacheRead: microCentsToCents(costMicro.cacheRead),
          total: microCentsToCents(totalMicro),
          subagentCost: microCentsToCents(subagentCostMicro),
        },
        subagentShare: totalMicro > 0 ? subagentCostMicro / totalMicro : 0,
        previous: {
          total: microCentsToCents(totalCostMicro(previousCostMicro)),
          input: microCentsToCents(previousCostMicro.input),
          output: microCentsToCents(previousCostMicro.output),
          cacheWrite: microCentsToCents(previousCostMicro.cacheWrite),
          cacheRead: microCentsToCents(previousCostMicro.cacheRead),
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
        },
        unpricedModels: [...unpricedModels],
      };
    }),

  tools: publicProcedure
    .input(requireValidRange(rangeInput.extend({ limit: z.number().int().min(1).max(200).default(20) })))
    .query(({ input }) => {
      const db = getDb();
      const sessionIds = resolveScopedSessionIds(db, input);
      const rows = queryToolRows(db, input.from, input.to, sessionIds);

      return summarizeTools(rows).slice(0, input.limit);
    }),

  fields: publicProcedure
    .input(requireValidRange(rangeInput.extend({ limit: z.number().int().min(1).max(200).default(20) })))
    .query(({ input }) => {
      const db = getDb();
      const sessionIds = resolveScopedSessionIds(db, input);
      const rows = queryFieldRows(db, input.from, input.to, sessionIds);

      return summarizeFields(rows).slice(0, input.limit);
    }),

  files: publicProcedure
    .input(
      requireValidRange(
        rangeInput.extend({
          limit: z.number().int().min(1).max(200).default(20),
          groupBy: z.enum(['path', 'ext', 'dir']).default('path'),
        }),
      ),
    )
    .query(({ input }) => {
      const db = getDb();
      const sessionIds = resolveScopedSessionIds(db, input);
      const rows = queryFileRows(db, input.from, input.to, sessionIds);

      return summarizeFiles(rows, input.groupBy).slice(0, input.limit);
    }),

  expensiveCalls: publicProcedure
    .input(requireValidRange(rangeInput.extend({ limit: z.number().int().min(1).max(200).default(20) })))
    .query(({ input }) => {
      const db = getDb();
      const sessionIds = resolveScopedSessionIds(db, input);
      if (isEmptyScope(sessionIds)) return [];

      const rows = db
        .select()
        .from(usageExpensiveCall)
        .where(and(...rangeConditions(usageExpensiveCall, input.from, input.to, sessionIds)))
        .orderBy(desc(usageExpensiveCall.tokenTurns))
        .limit(input.limit)
        .all();

      return rows.map((row) => ({
        date: row.date,
        sessionId: row.sessionId,
        callIndex: row.callIndex,
        tool: row.tool,
        field: row.field,
        tokens: row.tokens,
        tokenTurns: row.tokenTurns,
        costCents: microCentsToCents(row.attributedCostMicroCents),
        preview: row.preview,
      }));
    }),

  sessions: publicProcedure
    .input(
      requireValidRange(
        rangeInput.extend({
          limit: z.number().int().min(1).max(200).default(50),
          sort: z.enum(['cost', 'calls', 'recent']).default('cost'),
          includeSubagents: z.boolean().default(false),
        }),
      ),
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

      const topLevel = allRows.filter((row) => (!row.isSubagent || isOrphan(row)) && startedDateInRange(row, input.from, input.to));
      const rows = topLevel.map((row) => {
        const children = row.isSubagent ? [] : childrenByParent.get(row.sessionId) ?? [];
        const subagentCostCents = children.reduce((sum, child) => sum + child.estCostCents, 0);
        const subagentCalls = children.reduce((sum, child) => sum + child.apiCalls, 0);
        return toSessionRow(row, subagentCostCents, subagentCalls);
      });

      if (input.includeSubagents) {
        const nonOrphanChildren = allRows.filter(
          (row) => row.isSubagent && !isOrphan(row) && startedDateInRange(row, input.from, input.to),
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

    const session = { ...toSessionRow(row, subagentCostCents, subagentCalls), compactions: row.compactions };

    const subagents = children.map((child) => ({
      sessionId: child.sessionId,
      agentType: child.agentType,
      agentDescription: child.agentDescription,
      model: child.model,
      apiCalls: child.apiCalls,
      costCents: child.estCostCents,
    }));

    const tools = summarizeTools(
      db.select().from(usageTool).where(eq(usageTool.sessionId, input.sessionId)).all(),
    );
    const files = summarizeFiles(
      db.select().from(usageFile).where(eq(usageFile.sessionId, input.sessionId)).all(),
      'path',
    );
    const fields = summarizeFields(
      db.select().from(usageField).where(eq(usageField.sessionId, input.sessionId)).all(),
    );

    const callRows = db
      .select()
      .from(usageCall)
      .where(eq(usageCall.sessionId, input.sessionId))
      .orderBy(usageCall.callIndex)
      .all();
    const callSeries = callRows.map((call) => ({ callIndex: call.callIndex, cacheReadTokens: call.cacheReadTokens }));

    return { session, tools, files, fields, callSeries, subagents };
  }),

  refresh: publicProcedure
    .input(refreshInput)
    .mutation(({ ctx, input }) => refreshUsage(ctx.state, input?.since)),

  rebuild: publicProcedure.mutation(() => {
    if (isUsageScanInFlight()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'A scan is running now. Wait for it to finish, then try Rebuild again.',
      });
    }
    const db = getDb();
    rebuildUsageHistory(db);
    broadcastUsageChange(0, 0);
    return { rebuilt: true };
  }),
});
