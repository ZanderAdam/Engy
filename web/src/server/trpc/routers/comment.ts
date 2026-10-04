import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { commentThreads, threadComments, workspaces } from '../../db/schema';
import { LOCAL_USER_ID as USER_ID, commentScopeKey } from '@/lib/comment-feedback';
import {
  addComment as addCommentToThread,
  listThreadsInScope,
  requireThread,
  setThreadResolved,
  type CommentScope,
} from '../../services/comment';
import { buildPendingFeedback, markCommentsSent } from '../../services/comment-feedback';
import { onUserComment, sendPendingComments, setLiveTarget } from '../../comment-delivery';
import { clearLiveTarget, getLiveTarget } from '../../live-comment-targets';

type Reaction = { emoji: string; createdAt: string; userIds: string[] };

function resolveWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws)
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  return ws;
}

function getThreadWithComments(threadId: string) {
  const db = getDb();
  const thread = db.select().from(commentThreads).where(eq(commentThreads.id, threadId)).get();
  if (!thread) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
  const comments = db
    .select()
    .from(threadComments)
    .where(eq(threadComments.threadId, threadId))
    .orderBy(asc(threadComments.createdAt))
    .all();
  return { ...thread, comments };
}

const workspaceSlugField = z.string().optional();

const scopeSchema = z.object({
  workspaceSlug: workspaceSlugField,
  documentPath: z.string().min(1),
  prefix: z.boolean().optional(),
});

function resolveScope(scope: z.infer<typeof scopeSchema>): CommentScope {
  const workspaceId = scope.workspaceSlug ? resolveWorkspace(scope.workspaceSlug).id : null;
  return { workspaceId, documentPath: scope.documentPath, prefix: scope.prefix };
}

const feedbackOptionsSchema = {
  markdown: z.string().optional(),
  filePath: z.string().optional(),
  threadIds: z.array(z.string()).optional(),
};

export const commentRouter = router({
  createThread: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        documentPath: z.string().min(1),
        threadId: z.string(),
        initialComment: z.object({
          id: z.string(),
          body: z.any(),
          metadata: z.any().optional(),
        }),
        metadata: z.any().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const workspaceId = input.workspaceSlug ? resolveWorkspace(input.workspaceSlug).id : null;
      const db = getDb();
      const now = new Date().toISOString();

      db.insert(commentThreads)
        .values({
          id: input.threadId,
          workspaceId,
          documentPath: input.documentPath,
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(threadComments)
        .values({
          id: input.initialComment.id,
          threadId: input.threadId,
          userId: USER_ID,
          body: input.initialComment.body,
          metadata: input.initialComment.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      onUserComment(ctx.state, workspaceId, input.documentPath);
      return getThreadWithComments(input.threadId);
    }),

  deleteThread: publicProcedure
    .input(z.object({ workspaceSlug: workspaceSlugField, threadId: z.string() }))
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      db.delete(commentThreads).where(eq(commentThreads.id, input.threadId)).run();
      return { success: true };
    }),

  updateThreadMetadata: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        metadata: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      db.update(commentThreads)
        .set({ metadata: input.metadata, updatedAt: new Date().toISOString() })
        .where(eq(commentThreads.id, input.threadId))
        .run();
      return { success: true };
    }),

  resolveThread: publicProcedure
    .input(z.object({ workspaceSlug: workspaceSlugField, threadId: z.string() }))
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      setThreadResolved(input.threadId, true);
      return getThreadWithComments(input.threadId);
    }),

  unresolveThread: publicProcedure
    .input(z.object({ workspaceSlug: workspaceSlugField, threadId: z.string() }))
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      setThreadResolved(input.threadId, false);
      return getThreadWithComments(input.threadId);
    }),

  addComment: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        commentId: z.string(),
        body: z.any(),
        metadata: z.any().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const comment = addCommentToThread({
        threadId: input.threadId,
        commentId: input.commentId,
        body: input.body,
        metadata: input.metadata,
      });
      const thread = requireThread(input.threadId);
      onUserComment(ctx.state, thread.workspaceId, thread.documentPath);
      return comment;
    }),

  updateComment: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        commentId: z.string(),
        body: z.any(),
        metadata: z.any().optional(),
      }),
    )
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const now = new Date().toISOString();
      db.update(threadComments)
        .set({ body: input.body, metadata: input.metadata, updatedAt: now })
        .where(eq(threadComments.id, input.commentId))
        .run();
      db.update(commentThreads)
        .set({ updatedAt: now })
        .where(eq(commentThreads.id, input.threadId))
        .run();
      return { success: true };
    }),

  deleteComment: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        commentId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const now = new Date().toISOString();
      db.update(threadComments)
        .set({ body: null, deletedAt: now, updatedAt: now })
        .where(eq(threadComments.id, input.commentId))
        .run();
      return { success: true };
    }),

  addReaction: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        commentId: z.string(),
        emoji: z.string(),
      }),
    )
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const comment = db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, input.commentId))
        .get();
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });

      const reactions = (comment.reactions ?? []) as Reaction[];
      const existing = reactions.find((r) => r.emoji === input.emoji);
      if (existing) {
        if (!existing.userIds.includes(USER_ID)) existing.userIds.push(USER_ID);
      } else {
        reactions.push({
          emoji: input.emoji,
          createdAt: new Date().toISOString(),
          userIds: [USER_ID],
        });
      }
      db.update(threadComments)
        .set({ reactions })
        .where(eq(threadComments.id, input.commentId))
        .run();
      return { success: true };
    }),

  deleteReaction: publicProcedure
    .input(
      z.object({
        workspaceSlug: workspaceSlugField,
        threadId: z.string(),
        commentId: z.string(),
        emoji: z.string(),
      }),
    )
    .mutation(({ input }) => {
      if (input.workspaceSlug) resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const comment = db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, input.commentId))
        .get();
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });

      const reactions = (comment.reactions ?? []) as Reaction[];
      const filtered = reactions
        .map((r) =>
          r.emoji === input.emoji ? { ...r, userIds: r.userIds.filter((id) => id !== USER_ID) } : r,
        )
        .filter((r) => r.userIds.length > 0);
      db.update(threadComments)
        .set({ reactions: filtered })
        .where(eq(threadComments.id, input.commentId))
        .run();
      return { success: true };
    }),

  listThreads: publicProcedure
    .input(z.object({ workspaceSlug: workspaceSlugField, documentPath: z.string() }))
    .query(({ input }) => listThreadsInScope(resolveScope(input))),

  listThreadsByPrefix: publicProcedure
    .input(z.object({ workspaceSlug: workspaceSlugField, documentPathPrefix: z.string().min(1) }))
    .query(({ input }) =>
      listThreadsInScope(
        resolveScope({
          workspaceSlug: input.workspaceSlug,
          documentPath: input.documentPathPrefix,
          prefix: true,
        }),
      ),
    ),

  pendingFeedback: publicProcedure
    .input(z.object({ scope: scopeSchema, ...feedbackOptionsSchema }))
    .query(({ input }) => {
      const { scope, ...opts } = input;
      return buildPendingFeedback(resolveScope(scope), opts);
    }),

  markSent: publicProcedure
    .input(z.object({ commentIds: z.array(z.string()) }))
    .mutation(({ input }) => {
      markCommentsSent(input.commentIds);
      return { success: true };
    }),

  sendPending: publicProcedure
    .input(z.object({ scope: scopeSchema, sessionId: z.string().min(1), ...feedbackOptionsSchema }))
    .mutation(({ input, ctx }) => {
      const { scope, sessionId, ...opts } = input;
      return { sent: sendPendingComments(ctx.state, sessionId, resolveScope(scope), opts) };
    }),

  liveTarget: publicProcedure
    .input(scopeSchema)
    .query(({ input, ctx }) => ({ sessionId: getLiveTarget(ctx.state, commentScopeKey(input)) })),

  setLive: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        sessionId: z.string().min(1).nullable(),
        filePath: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const scopeKey = commentScopeKey(input.scope);
      if (input.sessionId === null) {
        clearLiveTarget(ctx.state, scopeKey);
      } else {
        setLiveTarget(ctx.state, scopeKey, {
          scope: resolveScope(input.scope),
          sessionId: input.sessionId,
          filePath: input.filePath,
        });
      }
      return { sessionId: input.sessionId };
    }),
});
