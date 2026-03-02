import { z } from 'zod';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { commentThreads, threadComments, workspaces } from '../../db/schema';

const USER_ID = 'local-user';

type Reaction = { emoji: string; createdAt: string; userIds: string[] };

function resolveWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
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

export const commentRouter = router({
  createThread: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
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
    .mutation(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const now = new Date().toISOString();

      db.insert(commentThreads)
        .values({
          id: input.threadId,
          workspaceId: ws.id,
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

      return getThreadWithComments(input.threadId);
    }),

  deleteThread: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), threadId: z.string() }))
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      db.delete(commentThreads).where(eq(commentThreads.id, input.threadId)).run();
      return { success: true };
    }),

  resolveThread: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), threadId: z.string() }))
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const now = new Date().toISOString();
      db.update(commentThreads)
        .set({ resolved: true, resolvedBy: USER_ID, resolvedAt: now, updatedAt: now })
        .where(eq(commentThreads.id, input.threadId))
        .run();
      return getThreadWithComments(input.threadId);
    }),

  unresolveThread: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), threadId: z.string() }))
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      db.update(commentThreads)
        .set({ resolved: false, resolvedBy: null, resolvedAt: null, updatedAt: new Date().toISOString() })
        .where(eq(commentThreads.id, input.threadId))
        .run();
      return getThreadWithComments(input.threadId);
    }),

  addComment: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        threadId: z.string(),
        commentId: z.string(),
        body: z.any(),
        metadata: z.any().optional(),
      }),
    )
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const now = new Date().toISOString();

      db.insert(threadComments)
        .values({
          id: input.commentId,
          threadId: input.threadId,
          userId: USER_ID,
          body: input.body,
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.update(commentThreads)
        .set({ updatedAt: now })
        .where(eq(commentThreads.id, input.threadId))
        .run();

      return db.select().from(threadComments).where(eq(threadComments.id, input.commentId)).get()!;
    }),

  updateComment: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        threadId: z.string(),
        commentId: z.string(),
        body: z.any(),
        metadata: z.any().optional(),
      }),
    )
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
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
        workspaceSlug: z.string(),
        threadId: z.string(),
        commentId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      db.update(threadComments)
        .set({ deletedAt: new Date().toISOString(), body: null })
        .where(eq(threadComments.id, input.commentId))
        .run();
      return { success: true };
    }),

  addReaction: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        threadId: z.string(),
        commentId: z.string(),
        emoji: z.string(),
      }),
    )
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const comment = db.select().from(threadComments).where(eq(threadComments.id, input.commentId)).get();
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });

      const reactions = (comment.reactions ?? []) as Reaction[];
      const existing = reactions.find((r) => r.emoji === input.emoji);
      if (existing) {
        if (!existing.userIds.includes(USER_ID)) existing.userIds.push(USER_ID);
      } else {
        reactions.push({ emoji: input.emoji, createdAt: new Date().toISOString(), userIds: [USER_ID] });
      }
      db.update(threadComments).set({ reactions }).where(eq(threadComments.id, input.commentId)).run();
      return { success: true };
    }),

  deleteReaction: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        threadId: z.string(),
        commentId: z.string(),
        emoji: z.string(),
      }),
    )
    .mutation(({ input }) => {
      resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const comment = db.select().from(threadComments).where(eq(threadComments.id, input.commentId)).get();
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });

      const reactions = (comment.reactions ?? []) as Reaction[];
      const filtered = reactions
        .map((r) =>
          r.emoji === input.emoji ? { ...r, userIds: r.userIds.filter((id) => id !== USER_ID) } : r,
        )
        .filter((r) => r.userIds.length > 0);
      db.update(threadComments).set({ reactions: filtered }).where(eq(threadComments.id, input.commentId)).run();
      return { success: true };
    }),

  listThreads: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        documentPath: z.string(),
      }),
    )
    .query(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const threads = db
        .select()
        .from(commentThreads)
        .where(
          and(eq(commentThreads.workspaceId, ws.id), eq(commentThreads.documentPath, input.documentPath)),
        )
        .orderBy(asc(commentThreads.createdAt))
        .all();

      return threads.map((thread) => {
        const cmts = db
          .select()
          .from(threadComments)
          .where(eq(threadComments.threadId, thread.id))
          .orderBy(asc(threadComments.createdAt))
          .all();
        return { ...thread, comments: cmts };
      });
    }),
});
