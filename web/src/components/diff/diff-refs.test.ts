import { describe, it, expect } from 'vitest';
import { latestRefs, refsFor } from './diff-refs';
import type { ChangedFile, GitFileStatus } from './types';

const HEAD = 'a1b2c3d4';

const file = (over: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'web/app.ts',
  status: 'modified' as GitFileStatus,
  staged: false,
  ...over,
});

describe('diff refs', () => {
  describe('latestRefs', () => {
    it('[FR-GIT-300] compares the last commit against the index for a staged row', () => {
      const refs = latestRefs(file({ staged: true, indexId: 'blob1' }), 'staged', HEAD);

      expect(refs).toMatchObject({ originalRef: HEAD, modifiedRef: ':0' });
    });

    it('[FR-GIT-300] compares the index against the working tree for an unstaged row', () => {
      const refs = latestRefs(file({ contentId: '10:1700' }), 'unstaged', HEAD);

      expect(refs.originalRef).toBe(':0');
      // No ref on the right: the working tree is not a commit.
      expect(refs.modifiedRef).toBeUndefined();
    });

    it('[FR-GIT-300] leaves the left side empty for a newly added file', () => {
      expect(latestRefs(file({ staged: true, status: 'added' }), 'staged', HEAD).originalRef)
        .toBeUndefined();
      expect(latestRefs(file({ status: 'added' }), 'unstaged', HEAD).originalRef).toBeUndefined();
    });

    it('[FR-GIT-300] leaves the left side empty when there is no commit to compare against', () => {
      expect(latestRefs(file({ staged: true }), 'staged', undefined).originalRef).toBeUndefined();
    });

    it('[FR-GIT-300] still reads the index for a file staged for deletion', () => {
      const refs = latestRefs(file({ status: 'deleted' }), 'unstaged', HEAD);

      expect(refs.originalRef).toBe(':0');
    });

    it('[FR-GIT-310] identifies staged content so re-staging is not served from cache', () => {
      const before = latestRefs(file({ staged: true, indexId: 'blob1' }), 'staged', HEAD);
      const after = latestRefs(file({ staged: true, indexId: 'blob2' }), 'staged', HEAD);

      expect(before.modifiedId).toBe('blob1');
      expect(after.modifiedId).not.toBe(before.modifiedId);
    });

    it('[FR-GIT-310] identifies working-tree content so an edit is not served from cache', () => {
      const before = latestRefs(file({ contentId: '10:1700' }), 'unstaged', HEAD);
      const after = latestRefs(file({ contentId: '12:1800' }), 'unstaged', HEAD);

      expect(before.modifiedId).toBe('10:1700');
      expect(after.modifiedId).not.toBe(before.modifiedId);
    });

    it('[FR-GIT-310] re-identifies an unstaged left side when the index or the commit moves', () => {
      const clean = latestRefs(file(), 'unstaged', HEAD);
      const staged = latestRefs(file({ indexId: 'blob1' }), 'unstaged', HEAD);
      const committed = latestRefs(file(), 'unstaged', 'e5f6a7b8');

      expect(clean.originalId).toBe(HEAD);
      expect(staged.originalId).toBe('blob1');
      expect(committed.originalId).not.toBe(clean.originalId);
    });

    it('[FR-GIT-310] leaves a commit to identify itself', () => {
      const refs = latestRefs(file({ staged: true, status: 'added' }), 'staged', HEAD);

      expect(refs.originalId).toBeUndefined();
    });
  });

  describe('refsFor', () => {
    const file = (over: Partial<ChangedFile> = {}): ChangedFile => ({
      path: 'a.ts',
      status: 'modified',
      staged: false,
      ...over,
    });

    const base = {
      selectedCommit: null,
      branchTarget: 'worktree' as const,
    };

    it('[FR-GIT-300] should defer to the latest-changes rules in latest mode', () => {
      expect(
        refsFor({ ...base, diffViewMode: 'latest', file: file({ indexId: 'i' }), side: 'staged', head: 'h' }),
      ).toEqual(latestRefs(file({ indexId: 'i' }), 'staged', 'h'));
    });

    it('[FR-GIT-350] should read nothing in latest mode without a side to read', () => {
      expect(refsFor({ ...base, diffViewMode: 'latest', file: file(), side: null })).toEqual({});
    });

    it('[FR-GIT-310] should pin a commit against its parent in history mode', () => {
      expect(
        refsFor({ ...base, diffViewMode: 'history', side: null, selectedCommit: 'abc' }),
      ).toEqual({ originalRef: 'abc~1', modifiedRef: 'abc' });
    });

    it('[FR-GIT-310] should pin both ends of a branch diff in PR mode', () => {
      expect(
        refsFor({
          ...base,
          diffViewMode: 'branch',
          side: null,
          branchTarget: 'head',
          branchDiff: { mergeBase: 'base1', head: 'head1' },
        }),
      ).toEqual({ originalRef: 'base1', modifiedRef: 'head1' });
    });

    it('[FR-GIT-310] should key the working-tree end of a branch diff on the file on disk', () => {
      expect(
        refsFor({
          ...base,
          diffViewMode: 'branch',
          file: file({ contentId: 'wt1' }),
          side: null,
          branchDiff: { mergeBase: 'base1' },
        }),
      ).toEqual({ originalRef: 'base1', modifiedId: 'wt1' });
    });

    it('[FR-GIT-350] should read nothing in branch mode before the fork point is known', () => {
      expect(refsFor({ ...base, diffViewMode: 'branch', side: null })).toEqual({});
    });
  });
});