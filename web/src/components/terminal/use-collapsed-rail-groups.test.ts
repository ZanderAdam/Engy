// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  readCollapsedRailGroups,
  subscribeCollapsedRailGroups,
  toggleRailGroupCollapsed,
} from './use-collapsed-rail-groups';

describe('terminal rail groups', () => {
  describe('collapsed state', () => {
    it('[FR-TERMINAL-950] should toggle a group, notify listeners and keep it in this browser', () => {
      let notified = 0;
      const unsubscribe = subscribeCollapsedRailGroups(() => notified++);

      toggleRailGroupCollapsed('g1');
      expect(readCollapsedRailGroups().has('g1')).toBe(true);
      expect(
        JSON.parse(window.localStorage.getItem('engy:terminal-rail-collapsed-groups:v1')!),
      ).toEqual(['g1']);

      toggleRailGroupCollapsed('g1');
      expect(readCollapsedRailGroups().has('g1')).toBe(false);
      expect(notified).toBe(2);

      unsubscribe();
    });

    it('should return a new set on each change so subscribers see it', () => {
      const before = readCollapsedRailGroups();
      toggleRailGroupCollapsed('g2');
      expect(readCollapsedRailGroups()).not.toBe(before);
      toggleRailGroupCollapsed('g2');
    });
  });
});
