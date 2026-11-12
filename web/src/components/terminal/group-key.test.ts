import { describe, expect, it } from 'vitest';
import {
  parseGroupKey,
  projectGroupKey,
  shellGroupKey,
  workspaceGroupKey,
  worktreeFromGroupKey,
} from './group-key';

describe('group key', () => {
  describe('worktreeFromGroupKey', () => {
    it('[FR-TERMINAL-1050] should read the worktree of a project group key', () => {
      const groupKey = projectGroupKey('engy', 'initial', 'feature/x');

      expect(worktreeFromGroupKey(groupKey)).toBe('feature/x');
    });

    it('[FR-TERMINAL-1050] should read the worktree of a shell group key', () => {
      const groupKey = shellGroupKey(projectGroupKey('engy', 'initial', 'feature'));

      expect(worktreeFromGroupKey(groupKey)).toBe('feature');
    });

    it('[FR-TERMINAL-1050] should return nothing for a main checkout group key', () => {
      expect(worktreeFromGroupKey(projectGroupKey('engy', 'initial'))).toBeUndefined();
    });

    it('[FR-TERMINAL-1050] should return nothing without a group key', () => {
      expect(worktreeFromGroupKey(undefined)).toBeUndefined();
    });
  });

  describe('parseGroupKey', () => {
    it('[FR-TERMINAL-1210] should read a project key built by projectGroupKey', () => {
      expect(parseGroupKey(projectGroupKey('ws', 'alpha'))).toEqual({
        shell: false,
        workspaceSlug: 'ws',
        projectSlug: 'alpha',
      });
    });

    it('[FR-TERMINAL-1210] should read the worktree branch of a project key', () => {
      expect(parseGroupKey(projectGroupKey('ws', 'alpha', 'feat/x'))).toEqual({
        shell: false,
        workspaceSlug: 'ws',
        projectSlug: 'alpha',
        worktreeBranch: 'feat/x',
      });
    });

    it('[FR-TERMINAL-1210] should read a workspace key', () => {
      expect(parseGroupKey(workspaceGroupKey('ws'))).toEqual({ shell: false, workspaceSlug: 'ws' });
    });

    it('[FR-TERMINAL-1210] should read a worktree-scope key as workspace only', () => {
      expect(parseGroupKey('worktree:ws')).toEqual({ shell: false, workspaceSlug: 'ws' });
    });

    it('[FR-TERMINAL-1210] should flag a shell key and read the key under it', () => {
      expect(parseGroupKey(`shell:${projectGroupKey('ws', 'alpha', 'b')}`)).toEqual({
        shell: true,
        workspaceSlug: 'ws',
        projectSlug: 'alpha',
        worktreeBranch: 'b',
      });
    });

    it('[FR-TERMINAL-1210] should return undefined for keys that name no workspace', () => {
      expect(parseGroupKey('dir:/tmp/x')).toBeUndefined();
      expect(parseGroupKey('project:ws')).toBeUndefined();
    });
  });
});
