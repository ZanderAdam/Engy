import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { tasks } from '../../db/schema';
import { detectCycle } from '../../tasks/validation';

export const taskRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        milestoneRef: z.string().optional(),
        taskGroupId: z.number().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(['ai', 'human']).default('human'),
        importance: z.enum(['important', 'not_important']).default('not_important'),
        urgency: z.enum(['urgent', 'not_urgent']).default('not_urgent'),
        dependencies: z.array(z.number()).default([]),
        specId: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();

      if (input.dependencies.length > 0) {
        const allTasks = new Map<number, number[]>();
        const existingTasks = db.select().from(tasks).all();
        for (const t of existingTasks) {
          allTasks.set(t.id, (t.dependencies as number[]) ?? []);
        }

        for (const depId of input.dependencies) {
          if (!allTasks.has(depId)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Dependency task ${depId} does not exist`,
            });
          }
        }
      }

      return db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          milestoneRef: input.milestoneRef,
          taskGroupId: input.taskGroupId,
          title: input.title,
          description: input.description,
          type: input.type,
          importance: input.importance,
          urgency: input.urgency,
          dependencies: input.dependencies,
          specId: input.specId,
        })
        .returning()
        .get();
    }),

  list: publicProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        milestoneRef: z.string().optional(),
        taskGroupId: z.number().optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDb();

      if (input.taskGroupId) {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.taskGroupId, input.taskGroupId))
          .all();
      }
      if (input.milestoneRef) {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.milestoneRef, input.milestoneRef))
          .all();
      }
      if (input.projectId) {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.projectId, input.projectId))
          .all();
      }

      return db.select().from(tasks).all();
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const task = db.select().from(tasks).where(eq(tasks.id, input.id)).get();
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    return task;
  }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
        type: z.enum(['ai', 'human']).optional(),
        importance: z.enum(['important', 'not_important']).optional(),
        urgency: z.enum(['urgent', 'not_urgent']).optional(),
        dependencies: z.array(z.number()).optional(),
        milestoneRef: z.string().nullable().optional(),
        taskGroupId: z.number().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;

      if (updates.dependencies) {
        const allTasks = new Map<number, number[]>();
        const existingTasks = db.select().from(tasks).all();
        for (const t of existingTasks) {
          allTasks.set(t.id, (t.dependencies as number[]) ?? []);
        }

        if (detectCycle(id, updates.dependencies, allTasks)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Circular dependency detected',
          });
        }
      }

      const result = db
        .update(tasks)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, id))
        .returning()
        .get();

      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      return result;
    }),

  listBySpecId: publicProcedure
    .input(z.object({ specId: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      return db.select().from(tasks).where(eq(tasks.specId, input.specId)).all();
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.id, input.id)).run();
    return { success: true };
  }),
});
