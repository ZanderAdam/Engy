import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
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

type InboxItem = typeof inboxItems.$inferSelect;
type InboxEvent = typeof inboxEvents.$inferSelect;

export interface UpsertItemInput {
  repoFullName: string;
  prNumber: number;
  title: string;
  url: string;
  githubThreadId?: string | null;
  workspaceId?: number | null;
  repoPath?: string | null;
  facts?: BucketFacts;
  firstEventAt?: string;
}

interface AddEventInput {
  itemId: number;
  kind: InboxEventKind;
  summary: string;
  at: string;
  sourceKey: string;
  actor?: string | null;
  url?: string | null;
  facts?: BucketFacts;
}

interface InboxFilter {
  tab: 'priority' | 'all';
  workspaceId?: number;
  includeSnoozed?: boolean;
  ids?: number[];
}

interface InboxCounts {
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
  if (filter.ids !== undefined) conditions.push(inArray(inboxItems.id, filter.ids));
  return and(...conditions);
}

function withUnreadMention(
  facts: BucketFacts,
  item: InboxItem,
  db: Pick<ReturnType<typeof getDb>, 'select'>,
): BucketFacts {
  if (facts.mentioned) return facts;
  const conditions: SQL[] = [eq(inboxEvents.itemId, item.id), eq(inboxEvents.kind, 'mentioned')];
  if (item.lastReadAt) conditions.push(gt(inboxEvents.at, item.lastReadAt));
  const mention = db
    .select({ id: inboxEvents.id })
    .from(inboxEvents)
    .where(and(...conditions))
    .limit(1)
    .get();
  return mention ? { ...facts, mentioned: true } : facts;
}

export function findItemByPr(repoFullName: string, prNumber: number): InboxItem | undefined {
  return getDb()
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.repoFullName, repoFullName), eq(inboxItems.prNumber, prNumber)))
    .get();
}

export function upsertItem(input: UpsertItemInput, now: Date = new Date()): InboxItem {
  const db = getDb();
  const timestamp = now.toISOString();
  const existing = findItemByPr(input.repoFullName, input.prNumber);

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
        lastEventAt: input.firstEventAt ?? timestamp,
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
      bucket: input.facts
        ? computeBucket(withUnreadMention(input.facts, existing, db))
        : existing.bucket,
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

    const bucket = input.facts
      ? computeBucket(withUnreadMention(input.facts, item, tx))
      : item.bucket;

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

export function notifyInboxChange(): void {
  notify(null);
}

export function markDone(itemId: number, now: Date = new Date(), broadcast = true): void {
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
  if (broadcast) notify(itemId);
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

export function getItem(itemId: number): InboxItem | undefined {
  return getDb().select().from(inboxItems).where(eq(inboxItems.id, itemId)).get();
}

export function listRecentEvents(itemId: number, limit: number): InboxEvent[] {
  return getDb()
    .select()
    .from(inboxEvents)
    .where(eq(inboxEvents.itemId, itemId))
    .orderBy(desc(inboxEvents.at), desc(inboxEvents.id))
    .limit(limit)
    .all();
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
