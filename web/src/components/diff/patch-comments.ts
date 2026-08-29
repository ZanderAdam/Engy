import { computeNewLineNumber, computeOldLineNumber, getChangeKey } from 'react-diff-view';
import type { ChangeData, HunkData } from 'react-diff-view';
import type { DiffComment } from './use-diff-comments';

type CommentSide = 'modified' | 'original';

interface AnchoredComments {
  /** Change key each thread renders against, for react-diff-view's `widgets`. */
  anchors: Map<string, string>;
  /** Threads whose line is not among the rendered changes — collapsed, or gone. */
  unanchored: DiffComment[];
}

/**
 * Which side a new comment records. A deleted line exists only on the original
 * side and has no new-side line number to anchor to, so it cannot be recorded as
 * `modified` the way every other line is.
 */
export function sideForChange(change: ChangeData): CommentSide {
  return change.type === 'delete' ? 'original' : 'modified';
}

/** The line number a comment on this change anchors to, in its own side's numbering. */
export function lineForChange(change: ChangeData): number {
  return sideForChange(change) === 'original'
    ? computeOldLineNumber(change)
    : computeNewLineNumber(change);
}

/**
 * Indexes the rendered changes by line number on each side.
 *
 * A change key is not reconstructible from a stored line number — a context line
 * keys on its *old* line number while an insert keys on its *new* one — so the
 * lookup has to walk the changes rather than build the key by hand.
 */
function indexChanges(hunks: HunkData[]) {
  const byNew = new Map<number, ChangeData>();
  const byOld = new Map<number, ChangeData>();

  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type !== 'delete') byNew.set(computeNewLineNumber(change), change);
      if (change.type !== 'insert') byOld.set(computeOldLineNumber(change), change);
    }
  }

  return { byNew, byOld };
}

/**
 * Maps stored `{ lineNumber, side }` thread metadata onto the changes currently
 * rendered. Must be recomputed against the *expanded* hunks, so expanding a
 * collapsed region re-anchors the threads inside it.
 */
export function anchorComments(hunks: HunkData[], comments: DiffComment[]): AnchoredComments {
  const { byNew, byOld } = indexChanges(hunks);
  const anchors = new Map<string, string>();
  const unanchored: DiffComment[] = [];

  for (const comment of comments) {
    const change =
      comment.side === 'original' ? byOld.get(comment.lineNumber) : byNew.get(comment.lineNumber);

    if (change) {
      anchors.set(comment.threadId, getChangeKey(change));
    } else {
      unanchored.push(comment);
    }
  }

  return { anchors, unanchored };
}

/**
 * Groups threads by the change they render against. react-diff-view renders one
 * widget per change, so threads sharing a line have to be rendered together.
 */
export function groupByChangeKey(
  comments: DiffComment[],
  anchors: Map<string, string>,
): Map<string, DiffComment[]> {
  const grouped = new Map<string, DiffComment[]>();

  for (const comment of comments) {
    const key = anchors.get(comment.threadId);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(comment);
    else grouped.set(key, [comment]);
  }

  return grouped;
}

/**
 * The source to hand the expansion hooks, or null to disable them.
 *
 * `expandCollapsedBlockBy` reads `hunks[0].oldStart` with no empty-array guard
 * (react-diff-view 3.3.3), so an empty hunk list plus a non-empty source throws.
 * That pair is reachable whenever a new patch is in flight while the previous
 * file's source is still held — switching branch-diff target, or any refetch.
 */
export function expansionSource(hunks: HunkData[], oldSource: string): string | null {
  return hunks.length > 0 && oldSource ? oldSource : null;
}

/** Total rendered rows, for the large-diff guard. */
export function countChanges(hunks: HunkData[]): number {
  return hunks.reduce((total, hunk) => total + hunk.changes.length, 0);
}
