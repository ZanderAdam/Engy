import { describe, it, expect } from 'vitest';
import {
  filterInboxItems,
  moveSelection,
  nextSelectionAfterRemoval,
  prKey,
  sortInboxItems,
  summarizeLatestEvent,
} from './inbox-helpers';

describe('inbox-helpers', () => {
  describe('summarizeLatestEvent', () => {
    it('should join actor and verb', () => {
      expect(summarizeLatestEvent({ kind: 'review_requested', actor: 'alice', summary: 'x' })).toBe(
        'alice requested your review',
      );
    });

    it('should fall back to the stored summary when there is no actor', () => {
      expect(summarizeLatestEvent({ kind: 'ci_failed', actor: null, summary: 'CI failing' })).toBe(
        'CI failing',
      );
    });

    it('should handle an item without events', () => {
      expect(summarizeLatestEvent(null)).toBe('No activity');
    });
  });

  describe('sortInboxItems', () => {
    it('should put unread first, then newest first', () => {
      const items = [
        { id: 1, unread: false, lastEventAt: '2026-09-30T10:00:00Z' },
        { id: 2, unread: true, lastEventAt: '2026-09-30T08:00:00Z' },
        { id: 3, unread: true, lastEventAt: '2026-09-30T09:00:00Z' },
        { id: 4, unread: false, lastEventAt: '2026-09-30T11:00:00Z' },
      ];
      expect(sortInboxItems(items).map((i) => i.id)).toEqual([3, 2, 4, 1]);
    });

    it('should not mutate the input', () => {
      const items = [
        { unread: false, lastEventAt: '2026-09-30T10:00:00Z' },
        { unread: true, lastEventAt: '2026-09-30T08:00:00Z' },
      ];
      sortInboxItems(items);
      expect(items[0].unread).toBe(false);
    });
  });

  describe('filterInboxItems', () => {
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

  describe('nextSelectionAfterRemoval', () => {
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

  describe('prKey', () => {
    it('should build the CI lookup key', () => {
      expect(prKey('acme/web', 7)).toBe('acme/web#7');
    });
  });
});
