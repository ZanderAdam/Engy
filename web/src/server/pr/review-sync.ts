import { eq } from 'drizzle-orm';
import { commentThreads, threadComments, prs } from '../db/schema';
import type { GhReviewComment } from '@engy/common';
import type { getDb } from '../db/client';

type Db = ReturnType<typeof getDb>;
type PrRow = typeof prs.$inferSelect;

function makeDocPath(repo: string, filePath: string): string {
  return `diff://${repo}/${filePath}`;
}

function threadIdFor(githubId: number): string {
  return `gh-thread-${githubId}`;
}

function commentIdFor(githubId: number): string {
  return `gh-comment-${githubId}`;
}

/**
 * Idempotently imports GitHub PR review comments into the comment thread system.
 *
 * Top-level comments (inReplyToId null) create one commentThreads row + one
 * threadComments row each. Replies add threadComments rows to the parent thread.
 * Re-running never duplicates rows; edited bodies are updated in place.
 * Locally-resolved threads are never auto-unresolved.
 * Comments deleted on GitHub are left as-is in the local DB.
 *
 * Known gap: force-pushes that move a comment's line do NOT update the existing
 * thread's documentPath or lineNumber. The thread keeps the position from when
 * it was first imported.
 */
export interface ReviewCommentSyncSummary {
  created: number;
  updated: number;
}

export function syncReviewComments(
  db: Db,
  prRow: PrRow,
  comments: GhReviewComment[],
): ReviewCommentSyncSummary {
  const now = new Date().toISOString();
  const topLevel = comments.filter((c) => c.inReplyToId === null);
  const replies = comments.filter((c) => c.inReplyToId !== null);
  let created = 0;
  let updated = 0;

  for (const comment of topLevel) {
    const threadId = threadIdFor(comment.githubId);
    const commentId = commentIdFor(comment.githubId);
    const docPath = makeDocPath(prRow.repo, comment.path);

    const existingThread = db
      .select()
      .from(commentThreads)
      .where(eq(commentThreads.id, threadId))
      .get();

    if (!existingThread) {
      db.insert(commentThreads)
        .values({
          id: threadId,
          workspaceId: null,
          documentPath: docPath,
          metadata: {
            source: 'github',
            prNumber: prRow.number,
            githubId: comment.githubId,
            path: comment.path,
            // line: raw nullable value from GitHub, preserved for fidelity
            // lineNumber: coerced to 0 when null, used by the diff viewer for rendering
            line: comment.line,
            lineNumber: comment.line ?? 0,
            author: comment.author,
            url: comment.url,
          },
          createdAt: comment.createdAt,
          updatedAt: now,
        })
        .run();

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
      created++;
    } else {
      const existingComment = db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, commentId))
        .get();

      if (existingComment && existingComment.body !== comment.body) {
        db.update(threadComments)
          .set({ body: comment.body, updatedAt: now })
          .where(eq(threadComments.id, commentId))
          .run();
        db.update(commentThreads)
          .set({ updatedAt: now })
          .where(eq(commentThreads.id, threadId))
          .run();
        updated++;
      }
    }
  }

  for (const comment of replies) {
    const commentId = commentIdFor(comment.githubId);
    const parentThreadId = threadIdFor(comment.inReplyToId!);

    const parentThread = db
      .select()
      .from(commentThreads)
      .where(eq(commentThreads.id, parentThreadId))
      .get();

    if (!parentThread) continue;

    const existingComment = db
      .select()
      .from(threadComments)
      .where(eq(threadComments.id, commentId))
      .get();

    if (!existingComment) {
      db.insert(threadComments)
        .values({
          id: commentId,
          threadId: parentThreadId,
          userId: comment.author,
          body: comment.body,
          metadata: { githubId: comment.githubId },
          createdAt: comment.createdAt,
          updatedAt: now,
        })
        .run();
      db.update(commentThreads)
        .set({ updatedAt: now })
        .where(eq(commentThreads.id, parentThreadId))
        .run();
      created++;
    } else if (existingComment.body !== comment.body) {
      db.update(threadComments)
        .set({ body: comment.body, updatedAt: now })
        .where(eq(threadComments.id, commentId))
        .run();
      db.update(commentThreads)
        .set({ updatedAt: now })
        .where(eq(commentThreads.id, parentThreadId))
        .run();
      updated++;
    }
  }

  return { created, updated };
}
