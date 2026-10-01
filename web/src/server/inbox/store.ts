import { and, desc, eq, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client';
import { inboxEvents, inboxItems } from '../db/schema';
import { broadcastInboxChange } from '../ws/broadcast';
import {
  computeBucket,
  isSnoozeDue,
  wakesSnooze,
  type BucketFacts,
  type InboxEventKind,
} from './bucket';

export type InboxItem = typeof inboxItems.$inferSelect;

export interface UpsertItemInput {
  repoFullName: string;
  prNumber: number;
  title: string;
  url: string;
  githubThreadId?: string | null;
  workspaceId?: number | null;
  repoPath?: string | null;
  facts?: BucketFacts;
}

export interface AddEventInput {
  itemId: number;
  kind: InboxEventKind;
  summary: string;
  at: string;
  sourceKey: string;
  actor?: string | null;
  url?: string | null;
  facts?: BucketFacts;
}

export interface InboxFilter {
  tab: 'priority' | 'all';
  workspaceId?: number;
  includeSnoozed?: boolean;
}

export interface InboxCounts {
  unreadPriority: number;
  byWorkspace: Record<number, number>;
}

export const DONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function notify(itemId: number | null): void {
  broadcastInboxChange(itemId, getInboxCounts().unreadPriority);
}

function visibleWhere(filter: InboxFilter): SQL | undefined {
  const conditions: SQL[] = [isNull(inboxItems.doneAt)];
  if (!filter.includeSnoozed) conditions.push(isNull(inboxItems.snoozedUntil));
  if (filter.tab === 'priority') conditions.push(eq(inboxItems.bucket, 'priority'));
  if (filter.workspaceId !== undefined) {
    conditions.push(eq(inboxItems.workspaceId, filter.workspaceId));
  }
  return and(...conditions);
}

export function upsertItem(input: UpsertItemInput, now: Date = new Date()): InboxItem {
  const db = getDb();
  const timestamp = now.toISOString();
  const existing = db
    .select()
    .from(inboxItems)
    .where(
      and(eq(inboxItems.repoFullName, input.repoFullName), eq(inboxItems.prNumber, input.prNumber)),
    )
    .get();

  if (!existing) {
    const created = db
      .insert(inboxItems)
      .values({
        repoFullName: input.repoFullName,
        prNumber: input.prNumber,
        title: input.title,
        url: input.url,
        githubThreadId: input.githubThreadId ?? null,
        workspaceId: input.workspaceId ?? null,
        repoPath: input.repoPath ?? null,
        bucket: input.facts ? computeBucket(input.facts) : 'other',
        lastEventAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();
    notify(created.id);
    return created;
  }

  const updated = db
    .update(inboxItems)
    .set({
      title: input.title,
      url: input.url,
      githubThreadId: input.githubThreadId ?? existing.githubThreadId,
      workspaceId: input.workspaceId ?? existing.workspaceId,
      repoPath: input.repoPath ?? existing.repoPath,
      bucket: input.facts ? computeBucket(input.facts) : existing.bucket,
      updatedAt: timestamp,
    })
    .where(eq(inboxItems.id, existing.id))
    .returning()
    .get();
  if (updated.bucket !== existing.bucket) notify(updated.id);
  return updated;
}

export function addEvent(input: AddEventInput, now: Date = new Date()): boolean {
  const db = getDb();
  const inserted = db.transaction((tx) => {
    const item = tx.select().from(inboxItems).where(eq(inboxItems.id, input.itemId)).get();
    if (!item) throw new Error(`Inbox item ${input.itemId} does not exist`);

    const event = tx
      .insert(inboxEvents)
      .values({
        itemId: input.itemId,
        kind: input.kind,
        actor: input.actor ?? null,
        summary: input.summary,
        url: input.url ?? null,
        at: input.at,
        sourceKey: input.sourceKey,
      })
      .onConflictDoNothing({ target: inboxEvents.sourceKey })
      .returning({ id: inboxEvents.id })
      .get();
    if (!event) return false;

    const bucket = input.facts ? computeBucket(input.facts) : item.bucket;
    const stillSnoozed = item.snoozedUntil !== null && !wakesSnooze(input.kind, bucket);
    tx.update(inboxItems)
      .set({
        unread: true,
        bucket,
        latestReason: input.kind,
        lastEventAt: input.at > item.lastEventAt ? input.at : item.lastEventAt,
        doneAt: null,
        snoozedUntil: stillSnoozed ? item.snoozedUntil : null,
        updatedAt: now.toISOString(),
      })
      .where(eq(inboxItems.id, input.itemId))
      .run();
    return true;
  });

  if (inserted) notify(input.itemId);
  return inserted;
}

export function markRead(itemId: number, now: Date = new Date()): void {
  getDb()
    .update(inboxItems)
    .set({ unread: false, lastReadAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(eq(inboxItems.id, itemId))
    .run();
  notify(itemId);
}

export function markUnread(itemId: number, now: Date = new Date()): void {
  getDb()
    .update(inboxItems)
    .set({ unread: true, updatedAt: now.toISOString() })
    .where(eq(inboxItems.id, itemId))
    .run();
  notify(itemId);
}

export function markAllRead(filter: InboxFilter, now: Date = new Date()): number {
  const where = and(visibleWhere(filter), eq(inboxItems.unread, true));
  const result = getDb()
    .update(inboxItems)
    .set({ unread: false, lastReadAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(where)
    .run();
  if (result.changes > 0) notify(null);
  return result.changes;
}

export function markDone(itemId: number, now: Date = new Date()): void {
  getDb()
    .update(inboxItems)
    .set({
      doneAt: now.toISOString(),
      unread: false,
      lastReadAt: now.toISOString(),
      snoozedUntil: null,
      updatedAt: now.toISOString(),
    })
    .where(eq(inboxItems.id, itemId))
    .run();
  notify(itemId);
}

export function snooze(itemId: number, until: Date, now: Date = new Date()): void {
  getDb()
    .update(inboxItems)
    .set({ snoozedUntil: until.toISOString(), updatedAt: now.toISOString() })
    .where(eq(inboxItems.id, itemId))
    .run();
  notify(itemId);
}

export function wakeDueSnoozes(now: Date): number {
  const db = getDb();
  const due = db
    .select({ id: inboxItems.id, snoozedUntil: inboxItems.snoozedUntil })
    .from(inboxItems)
    .where(and(isNotNull(inboxItems.snoozedUntil), isNull(inboxItems.doneAt)))
    .all()
    .filter((row) => isSnoozeDue(row.snoozedUntil, now))
    .map((row) => row.id);
  if (due.length === 0) return 0;

  db.update(inboxItems)
    .set({ snoozedUntil: null, unread: true, updatedAt: now.toISOString() })
    .where(inArray(inboxItems.id, due))
    .run();
  notify(null);
  return due.length;
}

export function pruneDone(now: Date): number {
  const cutoff = new Date(now.getTime() - DONE_RETENTION_MS).toISOString();
  const result = getDb()
    .delete(inboxItems)
    .where(and(isNotNull(inboxItems.doneAt), lte(inboxItems.doneAt, cutoff)))
    .run();
  if (result.changes > 0) notify(null);
  return result.changes;
}

export function listItems(filter: InboxFilter): InboxItem[] {
  return getDb()
    .select()
    .from(inboxItems)
    .where(visibleWhere(filter))
    .orderBy(desc(inboxItems.unread), desc(inboxItems.lastEventAt))
    .all();
}

export function getInboxCounts(): InboxCounts {
  const rows = getDb()
    .select({ workspaceId: inboxItems.workspaceId, count: sql<number>`count(*)` })
    .from(inboxItems)
    .where(
      and(
        isNull(inboxItems.doneAt),
        isNull(inboxItems.snoozedUntil),
        eq(inboxItems.bucket, 'priority'),
        eq(inboxItems.unread, true),
      ),
    )
    .groupBy(inboxItems.workspaceId)
    .all();

  const counts: InboxCounts = { unreadPriority: 0, byWorkspace: {} };
  for (const row of rows) {
    counts.unreadPriority += row.count;
    if (row.workspaceId !== null) counts.byWorkspace[row.workspaceId] = row.count;
  }
  return counts;
}
