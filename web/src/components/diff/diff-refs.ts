import type { BranchDiffTarget } from '@engy/common';
import type { ChangedFile, DiffSide, DiffViewMode } from './types';

/** Stage 0 of the index. `git show :0:<path>` is how git names it. */
const INDEX_REF = ':0';

interface DiffRefs {
  /** Ref holding the "before" content; undefined when there is none to read. */
  originalRef?: string;
  /** Ref holding the "after" content; undefined means the working tree. */
  modifiedRef?: string;
  /**
   * Identity of each side's content, mixed into the read's cache key. Both the
   * index and the working tree hand back different bytes under an unchanging
   * name, so a read keyed on the ref alone would serve whatever it fetched
   * first — the stale-diff failure these exist to prevent. A commit hash names
   * its own content and needs none.
   */
  originalId?: string;
  modifiedId?: string;
}

/**
 * Which two snapshots a "Latest changes" row compares. Staged rows reproduce
 * `git diff --cached` (the last commit against the index); unstaged rows
 * reproduce `git diff` (the index against the working tree). A path changed on
 * both sides is two rows, and each shows only its own half.
 */
export function latestRefs(file: ChangedFile, side: DiffSide, head?: string): DiffRefs {
  if (side === 'staged') {
    return {
      // Newly added: nothing at the last commit to compare against.
      originalRef: file.status === 'added' ? undefined : head,
      modifiedRef: INDEX_REF,
      modifiedId: file.indexId,
    };
  }
  return {
    // Untracked: no index entry, so the whole file reads as new.
    originalRef: file.status === 'added' ? undefined : INDEX_REF,
    // Staging changes the index; committing moves what an unstaged-only path's
    // index entry mirrors. Either invalidates the left pane.
    originalId: file.indexId ?? head,
    modifiedId: file.contentId,
  };
}

export interface DiffRefsInputs {
  diffViewMode: DiffViewMode;
  /** The row being read; absent while the selection is incomplete. */
  file?: ChangedFile;
  /** Which of a pending path's two changes the row is; null outside `latest`. */
  side: DiffSide | null;
  head?: string;
  selectedCommit: string | null;
  branchTarget: BranchDiffTarget;
  branchDiff?: { mergeBase: string; head?: string };
}

/**
 * Which snapshots a row's content is read at, across every view mode. Pure and
 * per-row, so one open file and a whole stack of them derive their refs the
 * same way.
 */
export function refsFor({
  diffViewMode,
  file,
  side,
  head,
  selectedCommit,
  branchTarget,
  branchDiff,
}: DiffRefsInputs): DiffRefs {
  if (diffViewMode === 'latest') {
    if (!file || !side) return {};
    return latestRefs(file, side, head);
  }

  if (diffViewMode === 'history') {
    return selectedCommit
      ? { originalRef: `${selectedCommit}~1`, modifiedRef: selectedCommit }
      : {};
  }

  // Until the file list arrives there is no commit to pin either side to, and
  // reading `HEAD` or a branch name would cache content under a ref that means
  // something else by the next commit.
  if (!branchDiff) return {};
  if (branchTarget === 'head') {
    return { originalRef: branchDiff.mergeBase, modifiedRef: branchDiff.head };
  }
  // Working-tree target: the right pane has no ref, only what is on disk.
  return { originalRef: branchDiff.mergeBase, modifiedId: file?.contentId };
}
