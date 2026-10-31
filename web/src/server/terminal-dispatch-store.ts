import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { dispatchNotices, dispatches } from './db/schema';
import type { DispatchEntry, DispatchStatus } from './trpc/context';

type DispatchRow = typeof dispatches.$inferSelect;

export const SETTLED_STATUSES: DispatchStatus[] = ['replied', 'stopped', 'failed'];

function toMs(iso: string | null): number | undefined {
  return iso == null ? undefined : Date.parse(iso);
}

function toIso(ms: number | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function rowToEntry(row: DispatchRow): DispatchEntry {
  return {
    correlationId: row.correlationId,
    workerSessionId: row.workerSessionId,
    originSessionId: row.originSessionId ?? undefined,
    message: row.message,
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    notifyOnReply: row.notifyOnReply,
    settledBy: row.settledBy ?? undefined,
    deliveryPromptId: row.deliveryPromptId ?? undefined,
    stopReason: row.stopReason ?? undefined,
    lastOutput: row.lastOutput ?? undefined,
    evidence: row.evidence ?? undefined,
    createdAt: Date.parse(row.createdAt),
    writtenAt: toMs(row.writtenAt),
    deliveredAt: toMs(row.deliveredAt),
    repliedAt: toMs(row.repliedAt),
  };
}

function entryToRow(entry: DispatchEntry): DispatchRow {
  return {
    correlationId: entry.correlationId,
    workerSessionId: entry.workerSessionId,
    originSessionId: entry.originSessionId ?? null,
    message: entry.message,
    status: entry.status,
    result: entry.result ?? null,
    error: entry.error ?? null,
    notifyOnReply: entry.notifyOnReply === true,
    settledBy: entry.settledBy ?? null,
    deliveryPromptId: entry.deliveryPromptId ?? null,
    stopReason: entry.stopReason ?? null,
    lastOutput: entry.lastOutput ?? null,
    evidence: entry.evidence ?? null,
    createdAt: new Date(entry.createdAt).toISOString(),
    writtenAt: toIso(entry.writtenAt),
    deliveredAt: toIso(entry.deliveredAt),
    repliedAt: toIso(entry.repliedAt),
  };
}

export function insertDispatch(entry: DispatchEntry): void {
  getDb().insert(dispatches).values(entryToRow(entry)).run();
}

export function saveDispatch(entry: DispatchEntry): void {
  const { correlationId, ...fields } = entryToRow(entry);
  getDb().update(dispatches).set(fields).where(eq(dispatches.correlationId, correlationId)).run();
}

export function getDispatch(correlationId: string): DispatchEntry | undefined {
  const row = getDb()
    .select()
    .from(dispatches)
    .where(eq(dispatches.correlationId, correlationId))
    .get();
  return row ? rowToEntry(row) : undefined;
}

export function listWorkerDispatches(
  workerSessionId: string,
  statuses: DispatchStatus[],
): DispatchEntry[] {
  return getDb()
    .select()
    .from(dispatches)
    .where(
      and(eq(dispatches.workerSessionId, workerSessionId), inArray(dispatches.status, statuses)),
    )
    .orderBy(asc(dispatches.createdAt), sql`rowid`)
    .all()
    .map(rowToEntry);
}

export function hasQueuedDispatch(workerSessionId: string): boolean {
  return (
    getDb()
      .select({ id: dispatches.correlationId })
      .from(dispatches)
      .where(and(eq(dispatches.workerSessionId, workerSessionId), eq(dispatches.status, 'queued')))
      .limit(1)
      .get() !== undefined
  );
}

export function pruneSettledDispatches(olderThanMs: number): string[] {
  const cutoff = new Date(olderThanMs).toISOString();
  return getDb()
    .delete(dispatches)
    .where(and(inArray(dispatches.status, SETTLED_STATUSES), lt(dispatches.repliedAt, cutoff)))
    .returning({ id: dispatches.correlationId })
    .all()
    .map((row) => row.id);
}

export function pushNotice(originSessionId: string, text: string): void {
  getDb().insert(dispatchNotices).values({ originSessionId, text }).run();
}

export function hasNotices(originSessionId: string): boolean {
  return (
    getDb()
      .select({ id: dispatchNotices.id })
      .from(dispatchNotices)
      .where(eq(dispatchNotices.originSessionId, originSessionId))
      .limit(1)
      .get() !== undefined
  );
}

export function listNotices(originSessionId: string): Array<{ id: number; text: string }> {
  return getDb()
    .select({ id: dispatchNotices.id, text: dispatchNotices.text })
    .from(dispatchNotices)
    .where(eq(dispatchNotices.originSessionId, originSessionId))
    .orderBy(asc(dispatchNotices.id))
    .all();
}

export function deleteNotices(ids: number[]): void {
  if (ids.length === 0) return;
  getDb().delete(dispatchNotices).where(inArray(dispatchNotices.id, ids)).run();
}

export function deleteNoticesFor(originSessionId: string): void {
  getDb().delete(dispatchNotices).where(eq(dispatchNotices.originSessionId, originSessionId)).run();
}
