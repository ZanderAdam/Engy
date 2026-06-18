import { describe, it, expect } from 'vitest';
import {
  canGoBack,
  canGoForward,
  closeTab,
  emptyTabsState,
  navigateBack,
  navigateForward,
  openTab,
  type TabsState,
} from './open-tabs';

function open(paths: string[]): TabsState {
  return paths.reduce((state, p) => openTab(state, p), emptyTabsState);
}

describe('open-tabs', () => {
  describe('openTab', () => {
    it('should add a tab and make it active', () => {
      const state = openTab(emptyTabsState, 'a.ts');
      expect(state.tabs).toEqual(['a.ts']);
      expect(state.active).toBe('a.ts');
      expect(state.history).toEqual(['a.ts']);
      expect(state.historyIndex).toBe(0);
    });

    it('should not duplicate an already-open tab but re-activate it', () => {
      const state = openTab(open(['a.ts', 'b.ts']), 'a.ts');
      expect(state.tabs).toEqual(['a.ts', 'b.ts']);
      expect(state.active).toBe('a.ts');
    });

    it('should collapse consecutive navigations to the same file in history', () => {
      const state = openTab(openTab(emptyTabsState, 'a.ts'), 'a.ts');
      expect(state.history).toEqual(['a.ts']);
      expect(state.historyIndex).toBe(0);
    });

    it('should truncate forward history when opening after navigating back', () => {
      const back = navigateBack(open(['a.ts', 'b.ts', 'c.ts']));
      const state = openTab(back, 'd.ts');
      expect(state.history).toEqual(['a.ts', 'b.ts', 'd.ts']);
      expect(state.historyIndex).toBe(2);
      expect(state.active).toBe('d.ts');
    });
  });

  describe('closeTab', () => {
    it('should be a no-op for an unopened path', () => {
      const state = open(['a.ts']);
      expect(closeTab(state, 'missing.ts')).toBe(state);
    });

    it('should focus the right neighbour when closing the active tab', () => {
      const state = closeTab(open(['a.ts', 'b.ts', 'c.ts']), 'c.ts');
      // c was active; no right neighbour, so fall back to the left.
      expect(state.active).toBe('b.ts');
      expect(state.tabs).toEqual(['a.ts', 'b.ts']);
    });

    it('should pick the new right neighbour when closing a middle active tab', () => {
      let state = open(['a.ts', 'b.ts', 'c.ts']);
      state = openTab(state, 'b.ts');
      state = closeTab(state, 'b.ts');
      expect(state.active).toBe('c.ts');
    });

    it('should keep active untouched when closing a different tab', () => {
      const state = closeTab(open(['a.ts', 'b.ts']), 'a.ts');
      expect(state.active).toBe('b.ts');
      expect(state.tabs).toEqual(['b.ts']);
    });

    it('should clear active when the last tab is closed', () => {
      const state = closeTab(open(['a.ts']), 'a.ts');
      expect(state.active).toBeNull();
      expect(state.tabs).toEqual([]);
    });

    it('should prune closed files from history', () => {
      const state = closeTab(open(['a.ts', 'b.ts', 'c.ts']), 'b.ts');
      expect(state.history).not.toContain('b.ts');
    });
  });

  describe('navigation', () => {
    it('should report no back/forward on a fresh state', () => {
      expect(canGoBack(emptyTabsState)).toBe(false);
      expect(canGoForward(emptyTabsState)).toBe(false);
    });

    it('should go back and forward across history', () => {
      const state = open(['a.ts', 'b.ts', 'c.ts']);
      expect(canGoBack(state)).toBe(true);
      expect(canGoForward(state)).toBe(false);

      const back = navigateBack(state);
      expect(back.active).toBe('b.ts');
      expect(canGoForward(back)).toBe(true);

      const fwd = navigateForward(back);
      expect(fwd.active).toBe('c.ts');
    });

    it('should skip closed tabs when navigating back', () => {
      let state = open(['a.ts', 'b.ts', 'c.ts']);
      state = closeTab(state, 'b.ts'); // active becomes c.ts
      const back = navigateBack(state);
      expect(back.active).toBe('a.ts');
    });

    it('should be a no-op at history boundaries', () => {
      const state = open(['a.ts']);
      expect(navigateBack(state)).toBe(state);
      expect(navigateForward(state)).toBe(state);
    });
  });
});
