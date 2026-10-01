import { describe, it, expect } from 'vitest';
import {
  filterInboxItems,
  moveSelection,
  nextSelectionAfterRemoval,
  prKey,
  shouldStartReadDwell,
  sortInboxItems,
  formatSnoozeUntil,
  githubAvatarUrl,
  unreadPriorityCount,
  describeCleared,
  pickReviewProject,
  selectionAfterMarkRead,
} from './inbox-helpers';

describe('inbox-helpers', () => {
  describe('[FR-INBOX-530] describeCleared', () => {
    it('should report the cleared items', () => {
      expect(describeCleared(1, 0)).toBe('Cleared 1 item');
      expect(describeCleared(4, 0)).toBe('Cleared 4 items');
    });

    it('should report the GitHub write-back failures', () => {
      expect(describeCleared(4, 2)).toBe('Cleared 4 items, 2 could not be marked done on GitHub');
    });
  });

  describe('[FR-INBOX-480] unreadPriorityCount', () => {
    const counts = { unreadPriority: 5, byWorkspace: { 1: 3, 2: 2 } };

    it('should return the total without a workspace', () => {
      expect(unreadPriorityCount(counts, undefined)).toBe(5);
    });

    it('should return only the workspace count when locked', () => {
      expect(unreadPriorityCount(counts, 1)).toBe(3);
      expect(unreadPriorityCount(counts, 9)).toBe(0);
    });
  });

  describe('[FR-INBOX-450] sortInboxItems', () => {
    it('should put unread first, then newest first', () => {
      const items = [
        { id: 1, unread: false, lastEventAt: '2026-09-30T10:00:00Z' },
        { id: 2, unread: true, lastEventAt: '2026-09-30T08:00:00Z' },
        { id: 3, unread: true, lastEventAt: '2026-09-30T09:00:00Z' },
        { id: 4, unread: false, lastEventAt: '2026-09-30T11:00:00Z' },
      ];
      expect(sortInboxItems(items, true).map((i) => i.id)).toEqual([3, 2, 4, 1]);
    });

    it('should sort by time only when unread first is off', () => {
      const items = [
        { id: 1, unread: false, lastEventAt: '2026-09-30T10:00:00Z' },
        { id: 2, unread: true, lastEventAt: '2026-09-30T08:00:00Z' },
        { id: 4, unread: false, lastEventAt: '2026-09-30T11:00:00Z' },
      ];
      expect(sortInboxItems(items, false).map((i) => i.id)).toEqual([4, 1, 2]);
    });

    it('should not mutate the input', () => {
      const items = [
        { unread: false, lastEventAt: '2026-09-30T10:00:00Z' },
        { unread: true, lastEventAt: '2026-09-30T08:00:00Z' },
      ];
      sortInboxItems(items, true);
      expect(items[0].unread).toBe(false);
    });
  });

  describe('[FR-INBOX-450] filterInboxItems', () => {
    const items = [
      { title: 'Fix login bug', repoFullName: 'acme/web' },
      { title: 'Add cache', repoFullName: 'acme/api' },
    ];

    it('should match title or repo, ignoring case', () => {
      expect(filterInboxItems(items, 'LOGIN')).toEqual([items[0]]);
      expect(filterInboxItems(items, 'acme/api')).toEqual([items[1]]);
    });

    it('should return all items for a blank query', () => {
      expect(filterInboxItems(items, '  ')).toEqual(items);
    });
  });

  describe('moveSelection', () => {
    it('should move and clamp at the ends', () => {
      expect(moveSelection([1, 2, 3], 1, 1)).toBe(2);
      expect(moveSelection([1, 2, 3], 3, 1)).toBe(3);
      expect(moveSelection([1, 2, 3], 1, -1)).toBe(1);
    });

    it('should pick the first or last row when nothing is selected', () => {
      expect(moveSelection([1, 2, 3], null, 1)).toBe(1);
      expect(moveSelection([1, 2, 3], null, -1)).toBe(3);
      expect(moveSelection([1, 2, 3], 99, 1)).toBe(1);
    });

    it('should return null for an empty list', () => {
      expect(moveSelection([], null, 1)).toBeNull();
    });
  });

  describe('[FR-INBOX-450] nextSelectionAfterRemoval', () => {
    it('should select the row that takes the removed row place', () => {
      expect(nextSelectionAfterRemoval([1, 2, 3], 2)).toBe(3);
    });

    it('should select the previous row when the last row is removed', () => {
      expect(nextSelectionAfterRemoval([1, 2, 3], 3)).toBe(2);
    });

    it('should return null when no row is left or the id is unknown', () => {
      expect(nextSelectionAfterRemoval([1], 1)).toBeNull();
      expect(nextSelectionAfterRemoval([1, 2], 9)).toBeNull();
    });
  });

  describe('[FR-INBOX-470] shouldStartReadDwell', () => {
    it('should start for an explicit selection in the active tab', () => {
      expect(shouldStartReadDwell(3, 3, true)).toBe(true);
    });

    it('should not start for the fallback selection', () => {
      expect(shouldStartReadDwell(null, 3, true)).toBe(false);
    });

    it('should not start when the explicit row is no longer visible', () => {
      expect(shouldStartReadDwell(9, 3, true)).toBe(false);
    });

    it('should not start in a hidden tab', () => {
      expect(shouldStartReadDwell(3, 3, false)).toBe(false);
    });
  });

  describe('[FR-INBOX-570] selectionAfterMarkRead', () => {
    it('should pin the selection to a row that is marked read', () => {
      expect(selectionAfterMarkRead(null, 'a', true)).toBe('a');
      expect(selectionAfterMarkRead('b', 'a', true)).toBe('a');
    });

    it('should keep the selection when the row is marked unread', () => {
      expect(selectionAfterMarkRead(null, 'a', false)).toBeNull();
      expect(selectionAfterMarkRead('b', 'a', false)).toBe('b');
    });
  });

  describe('prKey', () => {
    it('should build the CI lookup key', () => {
      expect(prKey('acme/web', 7)).toBe('acme/web#7');
    });
  });

  describe('githubAvatarUrl', () => {
    it('should build the avatar url', () => {
      expect(githubAvatarUrl('alice')).toBe('https://github.com/alice.png?size=40');
    });
  });

  describe('formatSnoozeUntil', () => {
    it('should show weekday and 24h time', () => {
      expect(formatSnoozeUntil(new Date(2026, 9, 5, 9, 0).toISOString())).toBe(
        'Snoozed until Mon 09:00',
      );
    });
  });

  describe('[FR-INBOX-560] pickReviewProject', () => {
    const projects = [
      { slug: 'alpha', isDefault: false },
      { slug: 'default', isDefault: true },
    ];

    it('should prefer the project of the correlated agent session', () => {
      expect(pickReviewProject(projects, 'alpha')).toBe('alpha');
    });

    it('should fall back to the default project', () => {
      expect(pickReviewProject(projects, null)).toBe('default');
    });

    it('should fall back to the first project when none is the default', () => {
      expect(pickReviewProject([{ slug: 'alpha', isDefault: false }], null)).toBe('alpha');
    });

    it('should return null when the workspace has no project', () => {
      expect(pickReviewProject([], null)).toBeNull();
    });
  });
});
