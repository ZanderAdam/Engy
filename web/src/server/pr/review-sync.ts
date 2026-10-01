import { eq } from 'drizzle-orm';
import { commentThreads, threadComments } from '../db/schema';
import type { GithubReviewThread, GithubReviewThreadComment } from '../github/review-threads';
import type { getDb } from '../db/client';
import { diffDocPath } from '@/lib/diff-doc-path';

type Db = ReturnType<typeof getDb>;

export interface ReviewSyncTarget {
  repo: string;
  number: number;
  headBranch: string;
}
type ThreadRow = typeof commentThreads.$inferSelect;

interface ReviewThreadSyncSummary {
  created: number;
  updated: number;
}

function threadIdFor(githubId: number): string {
  return `gh-thread-${githubId}`;
}

function commentIdFor(githubId: number): string {
  return `gh-comment-${githubId}`;
}

function threadMetadata(
  target: ReviewSyncTarget,
  thread: GithubReviewThread,
  rootComment: GithubReviewThreadComment,
) {
  return {
    source: 'github',
    prNumber: target.number,
    githubId: rootComment.githubId,
    githubThreadNodeId: thread.nodeId,
    path: thread.path,
    line: thread.line,
    originalLine: thread.originalLine,
    startLine: thread.startLine,
    lineNumber: thread.line ?? thread.originalLine ?? 0,
    diffSide: thread.diffSide,
    isOutdated: thread.isOutdated,
    author: rootComment.author,
    url: rootComment.url,
  };
}

function insertThread(
  db: Db,
  target: ReviewSyncTarget,
  thread: GithubReviewThread,
  rootComment: GithubReviewThreadComment,
  now: string,
): void {
  db.insert(commentThreads)
    .values({
      id: threadIdFor(rootComment.githubId),
      workspaceId: null,
      documentPath: diffDocPath(target.repo, target.headBranch, thread.path),
      resolved: thread.isResolved,
      resolvedBy: thread.isResolved ? 'github' : null,
      resolvedAt: thread.isResolved ? now : null,
      metadata: threadMetadata(target, thread, rootComment),
      createdAt: rootComment.createdAt,
      updatedAt: now,
    })
    .run();
}

function syncExistingThread(
  db: Db,
  existing: ThreadRow,
  target: ReviewSyncTarget,
  thread: GithubReviewThread,
  rootComment: GithubReviewThreadComment,
  now: string,
): boolean {
  const currentMetadata = existing.metadata ?? {};
  const nextMetadata = { ...currentMetadata, ...threadMetadata(target, thread, rootComment) };
  const metadataChanged = JSON.stringify(currentMetadata) !== JSON.stringify(nextMetadata);

  const locallyDismissed = currentMetadata.localDismissed === true;
  const nextResolved = locallyDismissed ? existing.resolved : thread.isResolved;
  const resolvedChanged = nextResolved !== existing.resolved;

  if (!metadataChanged && !resolvedChanged) return false;

  db.update(commentThreads)
    .set({
      metadata: nextMetadata,
      ...(resolvedChanged && {
        resolved: nextResolved,
        resolvedBy: nextResolved ? 'github' : null,
        resolvedAt: nextResolved ? now : null,
      }),
      updatedAt: now,
    })
    .where(eq(commentThreads.id, existing.id))
    .run();
  return true;
}

function syncComment(
  db: Db,
  threadId: string,
  comment: GithubReviewThreadComment,
  now: string,
): 'created' | 'updated' | 'unchanged' {
  const commentId = commentIdFor(comment.githubId);
  const existing = db.select().from(threadComments).where(eq(threadComments.id, commentId)).get();

  if (!existing) {
    db.insert(threadComments)
      .values({
        id: commentId,
        threadId,
        userId: comment.author,
        body: comment.body,
        metadata: { githubId: comment.githubId },
        createdAt: comment.createdAt,
        updatedAt: now,
      })
      .run();
    return 'created';
  }

  if (existing.body === comment.body) return 'unchanged';
  db.update(threadComments)
    .set({ body: comment.body, updatedAt: now })
    .where(eq(threadComments.id, commentId))
    .run();
  return 'updated';
}

/**
 * Idempotently imports GitHub review threads into the comment thread system.
 *
 * Each thread becomes one commentThreads row keyed by its first comment's database id;
 * every comment in it becomes a threadComments row, in GitHub order. Re-running never
 * duplicates rows. Resolved state mirrors GitHub both ways unless metadata.localDismissed
 * is set. Comments deleted on GitHub are left as-is in the local DB.
 */
export function syncReviewThreads(
  db: Db,
  target: ReviewSyncTarget,
  threads: GithubReviewThread[],
): ReviewThreadSyncSummary {
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  for (const thread of threads) {
    const [rootComment] = thread.comments;
    if (!rootComment) continue;

    const threadId = threadIdFor(rootComment.githubId);
    const existing = db.select().from(commentThreads).where(eq(commentThreads.id, threadId)).get();

    let threadTouched = false;
    if (!existing) {
      insertThread(db, target, thread, rootComment, now);
      created++;
    } else if (syncExistingThread(db, existing, target, thread, rootComment, now)) {
      updated++;
      threadTouched = true;
    }

    for (const comment of thread.comments) {
      const outcome = syncComment(db, threadId, comment, now);
      if (outcome === 'unchanged') continue;
      if (existing && outcome === 'created') created++;
      if (outcome === 'updated') updated++;
      if (existing && !threadTouched) {
        db.update(commentThreads)
          .set({ updatedAt: now })
          .where(eq(commentThreads.id, threadId))
          .run();
        threadTouched = true;
      }
    }
  }

  return { created, updated };
}
