import type { GitPatchSpec, BranchDiffTarget } from '@engy/common';
import type { ChangedFile, DiffSide, DiffViewMode } from './types';

export interface PatchSpecInputs {
  diffViewMode: DiffViewMode;
  /** Which of a pending path's two changes the row describes; null outside `latest`. */
  selectedSide: DiffSide | null;
  /** Commit the working tree's last commit resolved to, from the status read. */
  head?: string;
  selectedCommit: string | null;
  branchTarget: BranchDiffTarget;
  branchDiff?: { mergeBase: string; head?: string };
}

/**
 * Which two snapshots the selected row compares, named so the daemon can map it
 * straight onto a git invocation. The sibling of `latestRefs` in `diff-refs.ts`:
 * that answers "what content to read", this answers "what to compare".
 */
export function patchSpecFor({
  diffViewMode,
  selectedSide,
  head,
  selectedCommit,
  branchTarget,
  branchDiff,
}: PatchSpecInputs): GitPatchSpec | null {
  if (diffViewMode === 'latest') {
    if (!selectedSide) return null;
    return selectedSide === 'staged' ? { kind: 'staged', head } : { kind: 'unstaged' };
  }

  if (diffViewMode === 'history') {
    return selectedCommit ? { kind: 'commit', hash: selectedCommit } : null;
  }

  // Until the file list arrives there is no fork point to pin the left side to,
  // and naming `HEAD` would mean something else after the next commit.
  if (!branchDiff) return null;
  return branchTarget === 'head'
    ? { kind: 'range', from: branchDiff.mergeBase, to: branchDiff.head }
    : { kind: 'range', from: branchDiff.mergeBase };
}

/**
 * Identity of whatever mutable content the patch reads, mixed into the query key
 * so an edit, a `git add` or a commit is not served the patch computed before it
 * (FR-GIT-310). A range between two commits names its own content and needs none.
 */
export function patchContentId(spec: GitPatchSpec, file?: ChangedFile): string | undefined {
  switch (spec.kind) {
    case 'staged':
      return file?.indexId;
    case 'unstaged':
      // Both ends move: staging rewrites the index, editing rewrites the file.
      return `${file?.indexId ?? ''}:${file?.contentId ?? ''}`;
    case 'commit':
      return undefined;
    case 'range':
      return spec.to ? undefined : file?.contentId;
  }
}
