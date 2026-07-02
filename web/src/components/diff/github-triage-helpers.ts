import type { DiffComment } from './use-diff-comments';

/** Returns all unresolved GitHub-sourced threads. */
export function filterUnresolvedGithubThreads(comments: DiffComment[]): DiffComment[] {
  return comments.filter((c) => c.source === 'github' && !c.resolved);
}

/** Returns the subset of unresolved GitHub threads that are in selectedIds. */
export function getSelectedThreads(
  comments: DiffComment[],
  selectedIds: Set<string>,
): DiffComment[] {
  return filterUnresolvedGithubThreads(comments).filter((c) => selectedIds.has(c.threadId));
}

/** Returns a Set of all unresolved GitHub thread IDs. */
export function allGithubThreadIds(comments: DiffComment[]): Set<string> {
  return new Set(filterUnresolvedGithubThreads(comments).map((c) => c.threadId));
}

