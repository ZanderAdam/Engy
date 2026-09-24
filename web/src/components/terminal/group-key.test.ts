import { describe, it, expect } from 'vitest';
import { projectGroupKey, worktreeBranchFromGroupKey, workspaceGroupKey } from './group-key';

describe('terminal group keys', () => {
  describe('worktreeBranchFromGroupKey', () => {
    it('[FR-GIT-490] should read back the worktree a session was opened against', () => {
      expect(worktreeBranchFromGroupKey(projectGroupKey('engy', 'initial', 'feature/login'))).toBe(
        'feature/login',
      );
    });

    it('[FR-GIT-490] should report no worktree for a plain project session', () => {
      expect(worktreeBranchFromGroupKey(projectGroupKey('engy', 'initial'))).toBeUndefined();
      expect(worktreeBranchFromGroupKey(workspaceGroupKey('engy'))).toBeUndefined();
    });

    it('[FR-GIT-490] should keep a branch that itself contains the separator', () => {
      expect(worktreeBranchFromGroupKey(projectGroupKey('engy', 'initial', 'wt:odd'))).toBe(
        'wt:odd',
      );
    });
  });
});
