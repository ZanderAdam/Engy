import { describe, it, expect } from 'vitest';
import {
  computeInitialTabs,
  dedupeProjectTabs,
  findReusableProjectTab,
  projectTabKey,
  type Tab,
} from './tab-state';

function tab(partial: Partial<Tab> & { virtualPath: string }): Tab {
  return {
    id: partial.id ?? partial.virtualPath,
    virtualPath: partial.virtualPath,
    title: partial.title ?? partial.virtualPath,
    lastActiveAt: partial.lastActiveAt ?? 0,
  };
}

describe('tab-state dedup', () => {
  describe('projectTabKey', () => {
    it('should key project routes by workspace, project, and worktree', () => {
      expect(projectTabKey('/w/eng/projects/initial/code?wt=feature')).toBe(
        'eng/initial@feature',
      );
    });

    it('should ignore the section so different sections share a key', () => {
      const code = projectTabKey('/w/eng/projects/initial/code?wt=feature');
      const docs = projectTabKey('/w/eng/projects/initial/docs?wt=feature');
      expect(code).toBe(docs);
    });

    it('should treat absent worktree (default branch) as a distinct key from a named worktree', () => {
      const def = projectTabKey('/w/eng/projects/initial/code');
      const wt = projectTabKey('/w/eng/projects/initial/code?wt=feature');
      expect(def).toBe('eng/initial@');
      expect(def).not.toBe(wt);
    });

    it('should treat an empty wt param the same as an absent one (both default branch)', () => {
      expect(projectTabKey('/w/eng/projects/initial/code?wt=')).toBe(
        projectTabKey('/w/eng/projects/initial/code'),
      );
    });

    it('should return null for non-project paths', () => {
      expect(projectTabKey('/')).toBeNull();
      expect(projectTabKey('/open?path=/tmp/foo')).toBeNull();
      expect(projectTabKey('/w/eng/settings')).toBeNull();
    });
  });

  describe('findReusableProjectTab', () => {
    const tabs = [
      tab({ id: 'home', virtualPath: '/' }),
      tab({ id: 'a', virtualPath: '/w/eng/projects/initial/docs?wt=feature' }),
    ];

    it('should find a tab on the same project+worktree regardless of section', () => {
      const found = findReusableProjectTab(tabs, '/w/eng/projects/initial/code?wt=feature');
      expect(found?.id).toBe('a');
    });

    it('should not match a different worktree of the same project', () => {
      expect(findReusableProjectTab(tabs, '/w/eng/projects/initial/code')).toBeUndefined();
    });

    it('should never reuse for non-project paths', () => {
      expect(findReusableProjectTab(tabs, '/')).toBeUndefined();
    });
  });

  describe('dedupeProjectTabs', () => {
    it('should collapse same project+worktree tabs, keeping the most recently active', () => {
      const result = dedupeProjectTabs([
        tab({ id: 'old', virtualPath: '/w/eng/projects/initial/code?wt=feature', lastActiveAt: 1 }),
        tab({ id: 'new', virtualPath: '/w/eng/projects/initial/docs?wt=feature', lastActiveAt: 5 }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new');
    });

    it('should preserve order and keep distinct project+worktree combos', () => {
      const result = dedupeProjectTabs([
        tab({ id: 'home', virtualPath: '/' }),
        tab({ id: 'a', virtualPath: '/w/eng/projects/initial/code?wt=feature' }),
        tab({ id: 'b', virtualPath: '/w/eng/projects/initial/code' }),
      ]);
      expect(result.map((t) => t.id)).toEqual(['home', 'a', 'b']);
    });

    it('should never collapse non-project tabs even when identical', () => {
      const result = dedupeProjectTabs([
        tab({ id: 'h1', virtualPath: '/' }),
        tab({ id: 'h2', virtualPath: '/' }),
      ]);
      expect(result).toHaveLength(2);
    });

    it('should keep the most-recently-active duplicate at the first occurrence position', () => {
      const result = dedupeProjectTabs([
        tab({ id: 'old', virtualPath: '/w/eng/projects/initial/code', lastActiveAt: 1 }),
        tab({ id: 'home', virtualPath: '/' }),
        tab({ id: 'new', virtualPath: '/w/eng/projects/initial/docs', lastActiveAt: 9 }),
      ]);
      expect(result.map((t) => t.id)).toEqual(['new', 'home']);
    });
  });

  describe('computeInitialTabs', () => {
    const PATH = '/w/eng/projects/initial/code?wt=feature';

    it('should open a single fresh tab when nothing is persisted', () => {
      const { tabs, activeTabId } = computeInitialTabs(PATH, []);
      expect(tabs).toHaveLength(1);
      expect(tabs[0].virtualPath).toBe(PATH);
      expect(activeTabId).toBe(tabs[0].id);
    });

    it('should activate an exact-path match without adding a tab', () => {
      const persisted = [tab({ id: 'home', virtualPath: '/' }), tab({ id: 'exact', virtualPath: PATH })];
      const { tabs, activeTabId } = computeInitialTabs(PATH, persisted);
      expect(tabs).toHaveLength(2);
      expect(activeTabId).toBe('exact');
    });

    it('should reuse and navigate a same project+worktree tab on a different section', () => {
      const persisted = [
        tab({ id: 'home', virtualPath: '/' }),
        tab({ id: 'reuse', virtualPath: '/w/eng/projects/initial/docs?wt=feature' }),
      ];
      const { tabs, activeTabId } = computeInitialTabs(PATH, persisted);
      expect(tabs).toHaveLength(2);
      expect(activeTabId).toBe('reuse');
      expect(tabs.find((t) => t.id === 'reuse')?.virtualPath).toBe(PATH);
    });

    it('should prepend a new active tab when no match exists', () => {
      const persisted = [tab({ id: 'home', virtualPath: '/' })];
      const { tabs, activeTabId } = computeInitialTabs(PATH, persisted);
      expect(tabs).toHaveLength(2);
      expect(tabs[0].virtualPath).toBe(PATH);
      expect(activeTabId).toBe(tabs[0].id);
    });

    it('should collapse duplicate project tabs already persisted', () => {
      const persisted = [
        tab({ id: 'old', virtualPath: '/w/eng/projects/initial/code?wt=feature', lastActiveAt: 1 }),
        tab({ id: 'new', virtualPath: '/w/eng/projects/initial/docs?wt=feature', lastActiveAt: 5 }),
      ];
      const { tabs, activeTabId } = computeInitialTabs(PATH, persisted);
      expect(tabs).toHaveLength(1);
      expect(activeTabId).toBe('new');
      expect(tabs[0].virtualPath).toBe(PATH);
    });
  });
});
