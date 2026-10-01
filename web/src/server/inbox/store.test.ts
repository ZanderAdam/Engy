import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { inboxEvents, inboxItems, workspaces } from '../db/schema';
import * as broadcast from '../ws/broadcast';
import { NO_BUCKET_FACTS, type InboxEventKind } from './bucket';
import {
  DONE_RETENTION_MS,
  addEvent,
  getInboxCounts,
  listItems,
  markAllRead,
  markDone,
  markRead,
  markUnread,
  pruneDone,
  snooze,
  upsertItem,
  wakeDueSnoozes,
  type UpsertItemInput,
} from './store';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const PRIORITY_FACTS = { ...NO_BUCKET_FACTS, mentioned: true };

function itemInput(overrides: Partial<UpsertItemInput> = {}): UpsertItemInput {
  return {
    repoFullName: 'acme/api',
    prNumber: 1,
    title: 'Fix things',
    url: 'https://github.com/acme/api/pull/1',
    ...overrides,
  };
}

let eventSeq = 0;
function event(itemId: number, kind: InboxEventKind, at: string, sourceKey?: string) {
  eventSeq += 1;
  return { itemId, kind, summary: kind, at, sourceKey: sourceKey ?? `key-${eventSeq}` };
}

describe('inbox store', () => {
  let ctx: TestContext;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = setupTestDb();
    broadcastSpy = vi.spyOn(broadcast, 'broadcastInboxChange').mockImplementation(() => undefined);
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function seedWorkspace(slug: string): number {
    return ctx.db.insert(workspaces).values({ name: slug, slug, repos: [] }).returning().get().id;
  }

  function getItem(id: number) {
    return ctx.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get()!;
  }

  describe('upsertItem', () => {
    it('[FR-INBOX-070] should create an unread item in the other bucket by default', () => {
      const item = upsertItem(itemInput(), NOW);

      expect(item).toMatchObject({
        repoFullName: 'acme/api',
        prNumber: 1,
        bucket: 'other',
        unread: true,
        doneAt: null,
        snoozedUntil: null,
        lastEventAt: NOW.toISOString(),
      });
    });

    it('[FR-INBOX-070] should return the same row for the same repo and PR number', () => {
      const first = upsertItem(itemInput(), NOW);
      const second = upsertItem(itemInput({ title: 'New title', githubThreadId: '42' }), NOW);

      expect(second.id).toBe(first.id);
      expect(second.title).toBe('New title');
      expect(second.githubThreadId).toBe('42');
      expect(ctx.db.select().from(inboxItems).all()).toHaveLength(1);
    });

    it('[FR-INBOX-070] should keep existing optional fields when the update omits them', () => {
      const wsId = seedWorkspace('a');
      upsertItem(itemInput({ githubThreadId: '42', workspaceId: wsId, repoPath: '/repo' }), NOW);

      const updated = upsertItem(itemInput(), NOW);

      expect(updated).toMatchObject({ githubThreadId: '42', workspaceId: wsId, repoPath: '/repo' });
    });

    it('[FR-INBOX-080] should recompute the bucket from facts', () => {
      const item = upsertItem(itemInput({ facts: PRIORITY_FACTS }), NOW);
      expect(item.bucket).toBe('priority');

      const cleared = upsertItem(itemInput({ facts: NO_BUCKET_FACTS }), NOW);
      expect(cleared.bucket).toBe('other');
    });

    it('[FR-INBOX-080] should keep priority while a mention event is unread', () => {
      const item = upsertItem(itemInput(), NOW);
      addEvent(event(item.id, 'mentioned', '2026-03-01T11:00:00.000Z'), NOW);

      expect(upsertItem(itemInput({ facts: NO_BUCKET_FACTS }), NOW).bucket).toBe('priority');

      markRead(item.id, NOW);
      expect(upsertItem(itemInput({ facts: NO_BUCKET_FACTS }), NOW).bucket).toBe('other');
    });

    it('[FR-INBOX-080] should keep the bucket when no facts are given', () => {
      upsertItem(itemInput({ facts: PRIORITY_FACTS }), NOW);
      expect(upsertItem(itemInput(), NOW).bucket).toBe('priority');
    });

    it('[FR-INBOX-070] should broadcast on create and on bucket change only', () => {
      upsertItem(itemInput(), NOW);
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      upsertItem(itemInput({ title: 'Renamed' }), NOW);
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      upsertItem(itemInput({ facts: PRIORITY_FACTS }), NOW);
      expect(broadcastSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('addEvent', () => {
    it('[FR-INBOX-090] should store the event and mark the item unread with the latest reason', () => {
      const item = upsertItem(itemInput(), NOW);
      markRead(item.id, NOW);

      const added = addEvent(event(item.id, 'commented', '2026-03-02T00:00:00.000Z'), NOW);

      expect(added).toBe(true);
      expect(getItem(item.id)).toMatchObject({
        unread: true,
        latestReason: 'commented',
        lastEventAt: '2026-03-02T00:00:00.000Z',
      });
      expect(ctx.db.select().from(inboxEvents).all()).toHaveLength(1);
    });

    it('[FR-INBOX-090] should ignore an event with a known sourceKey', () => {
      const item = upsertItem(itemInput(), NOW);
      addEvent(event(item.id, 'commented', '2026-03-02T00:00:00.000Z', 'same'), NOW);
      markRead(item.id, NOW);
      broadcastSpy.mockClear();

      const added = addEvent(event(item.id, 'commented', '2026-03-03T00:00:00.000Z', 'same'), NOW);

      expect(added).toBe(false);
      expect(ctx.db.select().from(inboxEvents).all()).toHaveLength(1);
      expect(getItem(item.id).unread).toBe(false);
      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('[FR-INBOX-090] should not move lastEventAt backwards for an older event', () => {
      const item = upsertItem(itemInput(), NOW);
      addEvent(event(item.id, 'commented', '2026-03-05T00:00:00.000Z'), NOW);

      addEvent(event(item.id, 'pushed', '2026-03-02T00:00:00.000Z'), NOW);

      expect(getItem(item.id).lastEventAt).toBe('2026-03-05T00:00:00.000Z');
    });

    it('[FR-INBOX-090] should bring back a done item', () => {
      const item = upsertItem(itemInput(), NOW);
      markDone(item.id, NOW);

      addEvent(event(item.id, 'commented', '2026-03-02T00:00:00.000Z'), NOW);

      expect(getItem(item.id)).toMatchObject({ doneAt: null, unread: true });
    });

    it('[FR-INBOX-080] should recompute the bucket when facts are given', () => {
      const item = upsertItem(itemInput(), NOW);

      addEvent({ ...event(item.id, 'mentioned', NOW.toISOString()), facts: PRIORITY_FACTS }, NOW);

      expect(getItem(item.id).bucket).toBe('priority');
    });

    it('[FR-INBOX-090] should throw a clear error for an unknown item', () => {
      expect(() => addEvent(event(999, 'commented', NOW.toISOString()), NOW)).toThrow(
        'Inbox item 999 does not exist',
      );
    });

    describe('[FR-INBOX-100] with a snoozed item', () => {
      const until = new Date(NOW.getTime() + HOUR_MS);
      const cases: [InboxEventKind, boolean, boolean][] = [
        ['mentioned', true, true],
        ['ci_failed', true, true],
        ['commented', true, false],
        ['mentioned', false, false],
      ];

      it.each(cases)(
        'should handle %s with priority facts %s: wakes %s',
        (kind, priority, wakes) => {
          const item = upsertItem(itemInput(), NOW);
          snooze(item.id, until, NOW);

          addEvent(
            {
              ...event(item.id, kind, NOW.toISOString()),
              facts: priority ? PRIORITY_FACTS : NO_BUCKET_FACTS,
            },
            NOW,
          );

          const { snoozedUntil, unread } = getItem(item.id);
          expect(snoozedUntil).toBe(wakes ? null : until.toISOString());
          expect(unread).toBe(true);
        },
      );
    });

    it('[FR-INBOX-110] should broadcast the item id and the new unread priority count', () => {
      const item = upsertItem(itemInput(), NOW);
      broadcastSpy.mockClear();

      addEvent({ ...event(item.id, 'mentioned', NOW.toISOString()), facts: PRIORITY_FACTS }, NOW);

      expect(broadcastSpy).toHaveBeenCalledWith(item.id, 1);
    });
  });

  describe('[FR-INBOX-120] read state', () => {
    it('should mark an item read and unread', () => {
      const item = upsertItem(itemInput(), NOW);

      markRead(item.id, NOW);
      expect(getItem(item.id)).toMatchObject({ unread: false, lastReadAt: NOW.toISOString() });

      markUnread(item.id, NOW);
      expect(getItem(item.id).unread).toBe(true);
    });

    it('should mark all items matching the filter read', () => {
      const wsA = seedWorkspace('a');
      const wsB = seedWorkspace('b');
      const a = upsertItem(
        itemInput({ prNumber: 1, workspaceId: wsA, facts: PRIORITY_FACTS }),
        NOW,
      );
      const b = upsertItem(
        itemInput({ prNumber: 2, workspaceId: wsB, facts: PRIORITY_FACTS }),
        NOW,
      );
      const other = upsertItem(itemInput({ prNumber: 3, workspaceId: wsA }), NOW);

      const changed = markAllRead({ tab: 'priority', workspaceId: wsA }, NOW);

      expect(changed).toBe(1);
      expect(getItem(a.id).unread).toBe(false);
      expect(getItem(b.id).unread).toBe(true);
      expect(getItem(other.id).unread).toBe(true);
    });

    it('should leave snoozed and done items unread when marking all read', () => {
      const snoozed = upsertItem(itemInput({ prNumber: 1 }), NOW);
      const done = upsertItem(itemInput({ prNumber: 2 }), NOW);
      snooze(snoozed.id, new Date(NOW.getTime() + HOUR_MS), NOW);
      ctx.db
        .update(inboxItems)
        .set({ doneAt: NOW.toISOString() })
        .where(eq(inboxItems.id, done.id))
        .run();

      expect(markAllRead({ tab: 'all' }, NOW)).toBe(0);
    });

    it('should not broadcast when marking all read changes nothing', () => {
      broadcastSpy.mockClear();
      markAllRead({ tab: 'all' }, NOW);
      expect(broadcastSpy).not.toHaveBeenCalled();
    });
  });

  describe('[FR-INBOX-130] markDone and snooze', () => {
    it('should mark an item done, read and unsnoozed', () => {
      const item = upsertItem(itemInput(), NOW);
      snooze(item.id, new Date(NOW.getTime() + HOUR_MS), NOW);

      markDone(item.id, NOW);

      expect(getItem(item.id)).toMatchObject({
        doneAt: NOW.toISOString(),
        unread: false,
        snoozedUntil: null,
      });
    });

    it('should hide a snoozed item unless includeSnoozed is set', () => {
      const item = upsertItem(itemInput(), NOW);
      snooze(item.id, new Date(NOW.getTime() + HOUR_MS), NOW);

      expect(listItems({ tab: 'all' })).toHaveLength(0);
      expect(listItems({ tab: 'all', includeSnoozed: true })).toHaveLength(1);
    });
  });

  describe('[FR-INBOX-140] wakeDueSnoozes', () => {
    it('should wake only items whose snooze has passed and mark them unread', () => {
      const due = upsertItem(itemInput({ prNumber: 1 }), NOW);
      const later = upsertItem(itemInput({ prNumber: 2 }), NOW);
      markRead(due.id, NOW);
      snooze(due.id, new Date(NOW.getTime() - HOUR_MS), NOW);
      const laterUntil = new Date(NOW.getTime() + HOUR_MS);
      snooze(later.id, laterUntil, NOW);

      const woken = wakeDueSnoozes(NOW);

      expect(woken).toBe(1);
      expect(getItem(due.id)).toMatchObject({ snoozedUntil: null, unread: true });
      expect(getItem(later.id).snoozedUntil).toBe(laterUntil.toISOString());
    });

    it('should broadcast only when an item woke', () => {
      broadcastSpy.mockClear();
      expect(wakeDueSnoozes(NOW)).toBe(0);
      expect(broadcastSpy).not.toHaveBeenCalled();

      const item = upsertItem(itemInput(), NOW);
      snooze(item.id, new Date(NOW.getTime() - HOUR_MS), NOW);
      broadcastSpy.mockClear();

      wakeDueSnoozes(NOW);

      expect(broadcastSpy).toHaveBeenCalledWith(null, 0);
    });
  });

  describe('[FR-INBOX-150] pruneDone', () => {
    it('should delete items done for more than 30 days with their events', () => {
      const old = upsertItem(itemInput({ prNumber: 1 }), NOW);
      const recent = upsertItem(itemInput({ prNumber: 2 }), NOW);
      const open = upsertItem(itemInput({ prNumber: 3 }), NOW);
      addEvent(event(old.id, 'commented', NOW.toISOString()), NOW);
      markDone(old.id, new Date(NOW.getTime() - DONE_RETENTION_MS - HOUR_MS));
      markDone(recent.id, new Date(NOW.getTime() - DONE_RETENTION_MS + HOUR_MS));

      const removed = pruneDone(NOW);

      expect(removed).toBe(1);
      const remaining = ctx.db.select({ id: inboxItems.id }).from(inboxItems).all();
      expect(remaining.map((row) => row.id).sort()).toEqual([recent.id, open.id].sort());
      expect(ctx.db.select().from(inboxEvents).all()).toHaveLength(0);
    });
  });

  describe('[FR-INBOX-160] listItems', () => {
    it('should sort unread first, then newest event first', () => {
      const readNew = upsertItem(itemInput({ prNumber: 1 }), NOW);
      const unreadOld = upsertItem(itemInput({ prNumber: 2 }), NOW);
      const unreadNew = upsertItem(itemInput({ prNumber: 3 }), NOW);
      addEvent(event(readNew.id, 'commented', '2026-03-09T00:00:00.000Z'), NOW);
      addEvent(event(unreadOld.id, 'commented', '2026-03-01T00:00:00.000Z'), NOW);
      addEvent(event(unreadNew.id, 'commented', '2026-03-05T00:00:00.000Z'), NOW);
      markRead(readNew.id, NOW);

      const ids = listItems({ tab: 'all' }).map((item) => item.id);

      expect(ids).toEqual([unreadNew.id, unreadOld.id, readNew.id]);
    });

    it('should filter by tab and workspace and hide done items', () => {
      const wsA = seedWorkspace('a');
      const wsB = seedWorkspace('b');
      const prioA = upsertItem(
        itemInput({ prNumber: 1, workspaceId: wsA, facts: PRIORITY_FACTS }),
        NOW,
      );
      const otherA = upsertItem(itemInput({ prNumber: 2, workspaceId: wsA }), NOW);
      upsertItem(itemInput({ prNumber: 3, workspaceId: wsB, facts: PRIORITY_FACTS }), NOW);
      const done = upsertItem(itemInput({ prNumber: 4, workspaceId: wsA }), NOW);
      markDone(done.id, NOW);

      expect(listItems({ tab: 'priority', workspaceId: wsA }).map((i) => i.id)).toEqual([prioA.id]);
      expect(
        listItems({ tab: 'all', workspaceId: wsA })
          .map((i) => i.id)
          .sort(),
      ).toEqual([prioA.id, otherA.id].sort());
      expect(listItems({ tab: 'all' })).toHaveLength(3);
    });
  });

  describe('[FR-INBOX-170] getInboxCounts', () => {
    it('should count unread priority items in total and per workspace', () => {
      const wsA = seedWorkspace('a');
      const wsB = seedWorkspace('b');
      upsertItem(itemInput({ prNumber: 1, workspaceId: wsA, facts: PRIORITY_FACTS }), NOW);
      upsertItem(itemInput({ prNumber: 2, workspaceId: wsA, facts: PRIORITY_FACTS }), NOW);
      upsertItem(itemInput({ prNumber: 3, workspaceId: wsB, facts: PRIORITY_FACTS }), NOW);
      upsertItem(itemInput({ prNumber: 4, facts: PRIORITY_FACTS }), NOW);
      upsertItem(itemInput({ prNumber: 5, workspaceId: wsA }), NOW);
      const read = upsertItem(
        itemInput({ prNumber: 6, workspaceId: wsA, facts: PRIORITY_FACTS }),
        NOW,
      );
      markRead(read.id, NOW);
      const snoozed = upsertItem(
        itemInput({ prNumber: 7, workspaceId: wsB, facts: PRIORITY_FACTS }),
        NOW,
      );
      snooze(snoozed.id, new Date(NOW.getTime() + HOUR_MS), NOW);

      expect(getInboxCounts()).toEqual({
        unreadPriority: 4,
        byWorkspace: { [wsA]: 2, [wsB]: 1 },
      });
    });
  });
});
