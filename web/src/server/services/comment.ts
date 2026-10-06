import { and, asc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../db/client';
import { commentThreads, threadComments } from '../db/schema';
import { randomId } from '@/lib/random-id';
import { LOCAL_USER_ID, AGENT_USER_ID } from '@/lib/comment-feedback';
import { markdownToBlocks } from './markdown-blocks';
import { startsWithPrefix } from '../lib/path-prefix';

type CommentThread = typeof commentThreads.$inferSelect;
type ThreadComment = typeof threadComments.$inferSelect;
export type ThreadWithComments = CommentThread & { comments: ThreadComment[] };

export interface CommentScope {
  workspaceId: number | null;
  documentPath: string;
  prefix?: boolean;
}
type ThreadShape = Pick<CommentThread, 'documentPath' | 'metadata'>;

export function requireThread(threadId: string): CommentThread {
  const db = getDb();
  const thread = db.select().from(commentThreads).where(eq(commentThreads.id, threadId)).get();
  if (!thread) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Comment thread "${threadId}" not found — it may have been deleted. Re-read the feedback for a current thread id.`,
    });
  }
  return thread;
}

export function isDiffThread(thread: ThreadShape): boolean {
  return thread.metadata?.type === 'diff' || thread.documentPath.startsWith('diff://');
}

/**
 * Diff threads store a plain string body; doc threads store a BlockNote block
 * array. A raw string in a doc thread renders as an empty comment, so callers
 * that only have text must route it through here.
 */
export function textToBody(thread: ThreadShape, text: string): unknown {
  if (isDiffThread(thread)) return text;
  return markdownToBlocks(text);
}

interface AddCommentInput {
  threadId: string;
  commentId: string;
  body: unknown;
  metadata?: Record<string, unknown> | null;
  userId?: string;
}

export function addComment(input: AddCommentInput) {
  const thread = requireThread(input.threadId);
  const db = getDb();
  const now = new Date().toISOString();

  db.insert(threadComments)
    .values({
      id: input.commentId,
      threadId: thread.id,
      userId: input.userId ?? LOCAL_USER_ID,
      body: input.body,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.update(commentThreads).set({ updatedAt: now }).where(eq(commentThreads.id, thread.id)).run();

  return db.select().from(threadComments).where(eq(threadComments.id, input.commentId)).get()!;
}

export function setThreadResolved(threadId: string, resolved: boolean, userId = LOCAL_USER_ID) {
  const db = getDb();
  const now = new Date().toISOString();
  const fields = resolved
    ? { resolved: true, resolvedBy: userId, resolvedAt: now, updatedAt: now }
    : { resolved: false, resolvedBy: null, resolvedAt: null, updatedAt: now };
  db.update(commentThreads).set(fields).where(eq(commentThreads.id, threadId)).run();
}

interface ReplyInput {
  threadId: string;
  text: string;
  userId?: string;
  resolve?: boolean;
}

/**
 * Text-level reply used by agents: picks the body shape from the thread it is
 * answering, so one entry point serves both diff and doc threads.
 */
export function replyToThread(input: ReplyInput) {
  const thread = requireThread(input.threadId);
  const userId = input.userId ?? AGENT_USER_ID;

  const comment = addComment({
    threadId: thread.id,
    commentId: randomId(),
    body: textToBody(thread, input.text),
    userId,
  });

  if (input.resolve) setThreadResolved(thread.id, true, userId);

  return {
    threadId: thread.id,
    commentId: comment.id,
    documentPath: thread.documentPath,
    kind: isDiffThread(thread) ? ('diff' as const) : ('doc' as const),
    resolved: input.resolve === true,
  };
}

export function scopeContains(
  scope: CommentScope,
  workspaceId: number | null,
  documentPath: string,
) {
  if (scope.workspaceId !== workspaceId) return false;
  return scope.prefix
    ? documentPath.startsWith(scope.documentPath)
    : documentPath === scope.documentPath;
}

export function listThreadsInScope(scope: CommentScope): ThreadWithComments[] {
  const db = getDb();
  const workspaceCondition =
    scope.workspaceId === null
      ? isNull(commentThreads.workspaceId)
      : eq(commentThreads.workspaceId, scope.workspaceId);
  const pathCondition = scope.prefix
    ? startsWithPrefix(commentThreads.documentPath, scope.documentPath)
    : eq(commentThreads.documentPath, scope.documentPath);

  const threads = db
    .select()
    .from(commentThreads)
    .where(and(workspaceCondition, pathCondition))
    .orderBy(asc(commentThreads.createdAt))
    .all();

  return (
    threads
      .map((thread) => ({
        ...thread,
        comments: db
          .select()
          .from(threadComments)
          .where(eq(threadComments.threadId, thread.id))
          .orderBy(asc(threadComments.createdAt))
          .all(),
      }))
      .filter((thread) => thread.comments.length > 0)
      // LIKE ignores case and treats `_` and `%` as wildcards, so it only narrows the rows.
      .filter((thread) => scopeContains(scope, thread.workspaceId, thread.documentPath))
  );
}
