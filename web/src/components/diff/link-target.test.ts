import { describe, it, expect } from 'vitest';
import { worktreeForBranch } from './link-target';
import type { TaggedWorktreeEntry } from '@/server/trpc/routers/diff';

const main: TaggedWorktreeEntry = {
  path: '/home/dev/proj',
  branch: 'main',
  isMain: true,
  isLocked: false,
  location: 'local',
};
const feature: TaggedWorktreeEntry = {
  path: '/home/dev/worktrees/feature-login',
  branch: 'feature/login',
  isMain: false,
  isLocked: false,
  location: 'local',
};
const remote: TaggedWorktreeEntry = {
  path: '/workspaces/proj-wt',
  branch: 'remote-work',
  isMain: false,
  isLocked: false,
  location: { coderWorkspace: 'dev-box' },
};

describe('diffs page link target', () => {
  describe('worktreeForBranch', () => {
    it('[FR-GIT-500] should select the worktree holding the branch', () => {
      expect(worktreeForBranch([main, feature], 'feature/login')).toEqual({
        worktreePath: feature.path,
      });
    });

    it('[FR-GIT-500] should select the main repo when the branch is checked out there', () => {
      expect(worktreeForBranch([main, feature], 'main')).toBeNull();
    });

    it('[FR-GIT-500] should carry the coder workspace of a remote worktree', () => {
      expect(worktreeForBranch([main, remote], 'remote-work')).toEqual({
        worktreePath: remote.path,
        coderWorkspace: 'dev-box',
      });
    });

    it('[FR-GIT-500] should keep the reader’s own choice while the list is unknown', () => {
      expect(worktreeForBranch(undefined, 'feature/login')).toBeUndefined();
      expect(worktreeForBranch([main, feature], null)).toBeUndefined();
    });

    it('[FR-GIT-500] should keep the reader’s own choice when the branch has no worktree', () => {
      expect(worktreeForBranch([main, feature], 'gone')).toBeUndefined();
    });
  });
});
