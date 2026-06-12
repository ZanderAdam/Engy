import { describe, it, expect } from 'vitest';
import { projectGroupKey, normalizeWtParam } from '@/components/terminal/group-key';
import { buildQuickActionDirs } from '@/lib/shell';

/**
 * Tests for the pure logic that use-quick-action.ts applies when a ?wt param
 * is present: worktree repo remapping + group key generation.
 */
describe('use-quick-action worktree logic', () => {
  describe('groupKey generation', () => {
    it('produces a base group key when no worktree branch', () => {
      const key = projectGroupKey('my-ws', 'my-proj', undefined);
      expect(key).toBe('project:my-ws:my-proj');
    });

    it('appends :wt:<branch> suffix when worktree branch is provided', () => {
      const key = projectGroupKey('my-ws', 'my-proj', 'feat-x');
      expect(key).toBe('project:my-ws:my-proj:wt:feat-x');
    });
  });

  describe('normalizeWtParam', () => {
    it('returns undefined for null', () => {
      expect(normalizeWtParam(null)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeWtParam('')).toBeUndefined();
    });

    it('returns the branch name when non-empty', () => {
      expect(normalizeWtParam('feat-x')).toBe('feat-x');
    });
  });

  describe('worktree repo remapping', () => {
    it('remaps repos through the worktree map when a branch is active', () => {
      const repos = ['/repo/main', '/other/main'];
      const worktreeRepoMap = new Map([
        ['/repo/main', '/repo/wt/feat-x'],
        ['/other/main', '/other/wt/feat-x'],
      ]);
      const effectiveRepos = repos.map((r) => worktreeRepoMap.get(r) ?? r);
      expect(effectiveRepos).toEqual(['/repo/wt/feat-x', '/other/wt/feat-x']);
    });

    it('keeps original repos when not in worktree map', () => {
      const repos = ['/repo/main'];
      const worktreeRepoMap = new Map<string, string>();
      const effectiveRepos = repos.map((r) => worktreeRepoMap.get(r) ?? r);
      expect(effectiveRepos).toEqual(['/repo/main']);
    });

    it('uses remapped repos as workingDir via buildQuickActionDirs', () => {
      const repos = ['/repo/main'];
      const worktreeRepoMap = new Map([['/repo/main', '/repo/wt/feat-x']]);
      const effectiveRepos = repos.map((r) => worktreeRepoMap.get(r) ?? r);
      const { workingDir } = buildQuickActionDirs(effectiveRepos, '/project/dir');
      expect(workingDir).toBe('/repo/wt/feat-x');
    });

    it('wt group key + remapped workingDir are consistent', () => {
      const repos = ['/repo/main'];
      const worktreeRepoMap = new Map([['/repo/main', '/repo/wt/feat-x']]);
      const worktreeBranch = normalizeWtParam('feat-x');
      const effectiveRepos = worktreeBranch
        ? repos.map((r) => worktreeRepoMap.get(r) ?? r)
        : repos;
      const { workingDir } = buildQuickActionDirs(effectiveRepos, '/project/dir');
      const groupKey = projectGroupKey('ws', 'proj', worktreeBranch);

      expect(groupKey).toBe('project:ws:proj:wt:feat-x');
      expect(workingDir).toBe('/repo/wt/feat-x');
    });
  });
});
