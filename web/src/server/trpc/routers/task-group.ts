import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getDb } from '../../db/client.js';
import { taskGroups } from '../../db/schema.js';

export const taskGroupRouter = router({
  create: publicProcedure
    .input(
      z.object({
        milestoneId: z.number(),
        name: z.string().min(1),
        repos: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      return db
        .insert(taskGroups)
        .values({
          milestoneId: input.milestoneId,
          name: input.name,
          repos: input.repos,
        })
        .returning()
        .get();
    }),

  list: publicProcedure
    .input(z.object({ milestoneId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.milestoneId, input.milestoneId))
        .all();
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const group = db.select().from(taskGroups).where(eq(taskGroups.id, input.id)).get();
    if (!group) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task group not found' });
    }
    return group;
  }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        status: z.enum(['planned', 'active', 'review', 'complete']).optional(),
        repos: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const result = db
        .update(taskGroups)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(taskGroups.id, id))
        .returning()
        .get();

      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task group not found' });
      }
      return result;
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(taskGroups).where(eq(taskGroups.id, input.id)).run();
    return { success: true };
  }),
});
