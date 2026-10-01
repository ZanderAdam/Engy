import { computeNewLineNumber, computeOldLineNumber } from 'react-diff-view';
import type { HunkData } from 'react-diff-view';

type CommentSide = 'modified' | 'original';

export function isCommentableLine(
  hunks: HunkData[],
  lineNumber: number,
  side: CommentSide,
): boolean {
  return hunks.some((hunk) =>
    hunk.changes.some((change) => {
      if (side === 'original') {
        return change.type !== 'insert' && computeOldLineNumber(change) === lineNumber;
      }
      return change.type !== 'delete' && computeNewLineNumber(change) === lineNumber;
    }),
  );
}

type CommentOrigin = 'engy' | 'github' | 'github-draft';

export function commentOrigin(comment: { source: string; githubDraft: boolean }): CommentOrigin {
  if (comment.githubDraft) return 'github-draft';
  return comment.source === 'github' ? 'github' : 'engy';
}
