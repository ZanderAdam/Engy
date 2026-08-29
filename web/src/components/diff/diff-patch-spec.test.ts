import { describe, it, expect } from 'vitest';
import { patchSpecFor, patchContentId, type PatchSpecInputs } from './diff-patch-spec';
import type { ChangedFile } from './types';

const base: PatchSpecInputs = {
  diffViewMode: 'latest',
  selectedSide: 'unstaged',
  selectedCommit: null,
  branchTarget: 'worktree',
};

const file = (over: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'a.ts',
  status: 'modified',
  staged: false,
  ...over,
});

describe('diff patch spec', () => {
  describe('patchSpecFor', () => {
    it('[FR-GIT-300] should compare the head commit against the index for a staged row', () => {
      expect(patchSpecFor({ ...base, selectedSide: 'staged', head: 'abc123' })).toEqual({
        kind: 'staged',
        head: 'abc123',
      });
    });

    it('[FR-GIT-300] should compare the index against the working tree for an unstaged row', () => {
      expect(patchSpecFor({ ...base, selectedSide: 'unstaged' })).toEqual({ kind: 'unstaged' });
    });

    it('[FR-GIT-350] should produce no spec while the selection has no side to compare', () => {
      expect(patchSpecFor({ ...base, selectedSide: null })).toBeNull();
    });

    it('[FR-GIT-390] should compare a commit against its first parent in history mode', () => {
      expect(patchSpecFor({ ...base, diffViewMode: 'history', selectedCommit: 'deadbee' })).toEqual(
        { kind: 'commit', hash: 'deadbee' },
      );
    });

    it('[FR-GIT-350] should produce no spec in history mode until a commit is picked', () => {
      expect(patchSpecFor({ ...base, diffViewMode: 'history', selectedCommit: null })).toBeNull();
    });

    it('[FR-GIT-390] should compare the fork point against the working tree for a branch diff', () => {
      expect(
        patchSpecFor({
          ...base,
          diffViewMode: 'branch',
          branchTarget: 'worktree',
          branchDiff: { mergeBase: 'base1', head: 'head1' },
        }),
      ).toEqual({ kind: 'range', from: 'base1' });
    });

    it('[FR-GIT-390] should compare the fork point against the head commit for a PR diff', () => {
      expect(
        patchSpecFor({
          ...base,
          diffViewMode: 'branch',
          branchTarget: 'head',
          branchDiff: { mergeBase: 'base1', head: 'head1' },
        }),
      ).toEqual({ kind: 'range', from: 'base1', to: 'head1' });
    });

    it('[FR-GIT-350] should produce no spec in branch mode until the fork point is known', () => {
      expect(patchSpecFor({ ...base, diffViewMode: 'branch', branchDiff: undefined })).toBeNull();
    });
  });

  describe('patchContentId', () => {
    it('[FR-GIT-310] should key a staged patch on what the index holds', () => {
      expect(patchContentId({ kind: 'staged' }, file({ indexId: 'idx1' }))).toBe('idx1');
    });

    it('[FR-GIT-310] should key an unstaged patch on both the index and the working tree', () => {
      const id = patchContentId({ kind: 'unstaged' }, file({ indexId: 'idx1', contentId: 'wt1' }));

      expect(id).toContain('idx1');
      expect(id).toContain('wt1');
    });

    it('[FR-GIT-310] should distinguish a staged edit from a working-tree edit', () => {
      const staged = patchContentId({ kind: 'unstaged' }, file({ indexId: 'x', contentId: 'a' }));
      const edited = patchContentId({ kind: 'unstaged' }, file({ indexId: 'x', contentId: 'b' }));

      expect(staged).not.toBe(edited);
    });

    it('[FR-GIT-310] should require no identity for a commit, which names its own content', () => {
      expect(patchContentId({ kind: 'commit', hash: 'abc' }, file())).toBeUndefined();
    });

    it('[FR-GIT-310] should key a working-tree range on the file on disk', () => {
      expect(patchContentId({ kind: 'range', from: 'base' }, file({ contentId: 'wt1' }))).toBe(
        'wt1',
      );
    });

    it('[FR-GIT-310] should require no identity for a range between two commits', () => {
      expect(
        patchContentId({ kind: 'range', from: 'base', to: 'head' }, file({ contentId: 'wt1' })),
      ).toBeUndefined();
    });
  });
});
