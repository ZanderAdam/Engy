import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getDb } from '../../db/client.js';
import { tasks } from '../../db/schema.js';

function detectCycle(taskId: number, deps: number[], allTasks: Map<number, number[]>): boolean {
  const visited = new Set<number>();
  const stack = [...deps];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const currentDeps = allTasks.get(current) ?? [];
    stack.push(...currentDeps);
  }

  return false;
}

export const taskRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        milestoneId: z.number().optional(),
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

      // Validate no cycles in dependencies
      if (input.dependencies.length > 0) {
        const allTasks = new Map<number, number[]>();
        const existingTasks = db.select().from(tasks).all();
        for (const t of existingTasks) {
          allTasks.set(t.id, (t.dependencies as number[]) ?? []);
        }

        // Check each dependency exists
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
          milestoneId: input.milestoneId,
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
        milestoneId: z.number().optional(),
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
      if (input.milestoneId) {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.milestoneId, input.milestoneId))
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
        milestoneId: z.number().nullable().optional(),
        taskGroupId: z.number().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;

      // Validate no cycles if dependencies changed
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

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.id, input.id)).run();
    return { success: true };
  }),
});
