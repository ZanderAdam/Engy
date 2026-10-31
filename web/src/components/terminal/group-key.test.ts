import { describe, expect, it } from 'vitest';
import { projectGroupKey, worktreeFromGroupKey } from './group-key';

describe('group key', () => {
  describe('worktreeFromGroupKey', () => {
    it('[FR-TERMINAL-1050] should read the worktree of a project group key', () => {
      const groupKey = projectGroupKey('engy', 'initial', 'feature/x');

      expect(worktreeFromGroupKey(groupKey)).toBe('feature/x');
    });

    it('[FR-TERMINAL-1050] should read the worktree of a shell group key', () => {
      const groupKey = `shell:${projectGroupKey('engy', 'initial', 'feature')}`;

      expect(worktreeFromGroupKey(groupKey)).toBe('feature');
    });

    it('[FR-TERMINAL-1050] should return nothing for a main checkout group key', () => {
      expect(worktreeFromGroupKey(projectGroupKey('engy', 'initial'))).toBeUndefined();
    });

    it('[FR-TERMINAL-1050] should return nothing without a group key', () => {
      expect(worktreeFromGroupKey(undefined)).toBeUndefined();
    });
  });
});
