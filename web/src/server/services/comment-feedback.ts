import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { commentThreads, threadComments } from '../db/schema';
import { broadcastCommentChange } from '../ws/broadcast';
import { isPendingComment, LOCAL_USER_ID, type FeedbackComment } from '@/lib/comment-feedback';
import { formatCommentsForExport } from '@/lib/doc-feedback';
import { generateDiffFeedback } from '@/lib/diff-feedback';
import { listThreadsInScope, type CommentScope, type ThreadWithComments } from './comment';

export interface PendingFeedbackOptions {
  /** Current document text, so doc threads can name their line. */
  markdown?: string;
  filePath?: string;
  /** Limit the send to these threads, e.g. the ones on screen. */
  threadIds?: string[];
  /** Live mode: skip threads with no new user comment, so agent findings and synced GitHub comments wait for a manual send. */
  requireUserComment?: boolean;
}

interface PendingFeedback {
  text: string;
  commentIds: string[];
}

interface PendingThread {
  thread: ThreadWithComments;
  comments: FeedbackComment[];
  commentIds: string[];
  hasUserComment: boolean;
}

function pendingThread(thread: ThreadWithComments): PendingThread | null {
  const live = thread.comments.filter((c) => !c.deletedAt);
  const root = live[0];
  const pending = live.filter((c) => isPendingComment(c, c === root));
  if (pending.length === 0) return null;

  const comments: FeedbackComment[] = [];
  if (root && !pending.includes(root)) {
    comments.push({ userId: root.userId, body: root.body, context: true });
  }
  for (const c of pending) comments.push({ userId: c.userId, body: c.body });

  return {
    thread,
    comments,
    commentIds: pending.map((c) => c.id),
    hasUserComment: pending.some((c) => c.userId === LOCAL_USER_ID),
  };
}

export function buildPendingFeedback(
  scope: CommentScope,
  opts: PendingFeedbackOptions = {},
): PendingFeedback {
  const pending = listThreadsInScope(scope)
    .filter((t) => !t.resolved && (!opts.threadIds || opts.threadIds.includes(t.id)))
    .map(pendingThread)
    .filter((p) => p !== null)
    .filter((p) => !opts.requireUserComment || p.hasUserComment);

  if (pending.length === 0) return { text: '', commentIds: [] };

  const text = scope.documentPath.startsWith('diff://')
    ? generateDiffFeedback(
        pending.map(({ thread, comments }) => ({
          id: thread.id,
          documentPath: thread.documentPath,
          metadata: thread.metadata,
          comments,
        })),
      )
    : formatCommentsForExport({
        threads: new Map(
          pending.map(({ thread, comments }) => [
            thread.id,
            { resolved: false, metadata: thread.metadata, comments },
          ]),
        ),
        markdown: opts.markdown,
        filePath: opts.filePath,
      });

  if (!text) return { text: '', commentIds: [] };
  return { text, commentIds: pending.flatMap((p) => p.commentIds) };
}

export function markCommentsSent(commentIds: string[]): void {
  if (commentIds.length === 0) return;
  const db = getDb();
  db.update(threadComments)
    .set({ sentAt: new Date().toISOString() })
    .where(inArray(threadComments.id, commentIds))
    .run();

  const threads = db
    .selectDistinct({ id: commentThreads.id, documentPath: commentThreads.documentPath })
    .from(threadComments)
    .innerJoin(commentThreads, eq(threadComments.threadId, commentThreads.id))
    .where(inArray(threadComments.id, commentIds))
    .all();
  for (const thread of threads) broadcastCommentChange(thread.documentPath, thread.id);
}
