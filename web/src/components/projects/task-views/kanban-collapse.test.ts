import { describe, it, expect } from 'vitest';
import { laneCollapsed } from './kanban-collapse';

describe('kanban collapse', () => {
  describe('laneCollapsed', () => {
    it('should collapse backlog by default regardless of count', () => {
      expect(laneCollapsed('backlog', 5, undefined, true)).toBe(true);
    });

    it('should collapse an empty lane when the board has tasks', () => {
      expect(laneCollapsed('todo', 0, undefined, true)).toBe(true);
    });

    it('should not collapse empty lanes while the board is still loading', () => {
      expect(laneCollapsed('todo', 0, undefined, false)).toBe(false);
    });

    it('should expand a non-empty lane by default', () => {
      expect(laneCollapsed('in_progress', 3, undefined, true)).toBe(false);
    });

    it('should honor an explicit expand override on backlog', () => {
      expect(laneCollapsed('backlog', 0, false, true)).toBe(false);
    });

    it('should honor an explicit collapse override on a non-empty lane', () => {
      expect(laneCollapsed('done', 4, true, true)).toBe(true);
    });

    it('should let an override win over the loading guard in both directions', () => {
      expect(laneCollapsed('todo', 0, false, false)).toBe(false);
      expect(laneCollapsed('todo', 0, true, false)).toBe(true);
    });

    it('should keep backlog collapsed even while the board is loading', () => {
      expect(laneCollapsed('backlog', 0, undefined, false)).toBe(true);
    });
  });
});
