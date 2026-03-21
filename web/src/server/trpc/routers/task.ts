import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { tasks, taskDependencies } from '../../db/schema';
import { validateDependencies, attachBlockedBy } from '../../tasks/validation';

const subStatusEnum = z.enum(['planning', 'implementing', 'blocked', 'failed']);

function checkedValidateDeps(taskId: number | null, blockedBy: number[]): number[] {
  try {
    return validateDependencies(taskId, blockedBy);
  } catch (err) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
  }
}

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
        needsPlan: z.boolean().default(true),
        blockedBy: z.array(z.number()).default([]),
        specId: z.string().optional(),
        subStatus: subStatusEnum.optional(),
        sessionId: z.string().optional(),
        feedback: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { blockedBy: rawBlockedBy, ...values } = input;
      const dedupedBlockedBy = checkedValidateDeps(null, rawBlockedBy);

      return db.transaction((tx) => {
        const newTask = tx.insert(tasks).values(values).returning().get();

        for (const blockerId of dedupedBlockedBy) {
          tx.insert(taskDependencies)
            .values({ taskId: newTask.id, blockerTaskId: blockerId })
            .run();
        }

        return { ...newTask, blockedBy: dedupedBlockedBy };
      });
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

      let rows;
      if (input.taskGroupId) {
        rows = db.select().from(tasks).where(eq(tasks.taskGroupId, input.taskGroupId)).all();
      } else if (input.milestoneRef) {
        rows = db.select().from(tasks).where(eq(tasks.milestoneRef, input.milestoneRef)).all();
      } else if (input.projectId) {
        rows = db.select().from(tasks).where(eq(tasks.projectId, input.projectId)).all();
      } else {
        rows = db.select().from(tasks).all();
      }

      return attachBlockedBy(rows);
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const task = db.select().from(tasks).where(eq(tasks.id, input.id)).get();
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    return attachBlockedBy([task])[0];
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
        needsPlan: z.boolean().optional(),
        blockedBy: z.array(z.number()).optional(),
        milestoneRef: z.string().nullable().optional(),
        taskGroupId: z.number().nullable().optional(),
        subStatus: subStatusEnum.nullable().optional(),
        sessionId: z.string().nullable().optional(),
        feedback: z.string().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { id, blockedBy, ...updates } = input;

      const dedupedBlockedBy = blockedBy !== undefined
        ? checkedValidateDeps(id, blockedBy)
        : undefined;

      return db.transaction((tx) => {
        if (dedupedBlockedBy !== undefined) {
          tx.delete(taskDependencies).where(eq(taskDependencies.taskId, id)).run();
          for (const blockerId of dedupedBlockedBy) {
            tx.insert(taskDependencies)
              .values({ taskId: id, blockerTaskId: blockerId })
              .run();
          }
        }

        const result = tx
          .update(tasks)
          .set({ ...updates, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, id))
          .returning()
          .get();

        if (!result) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        return attachBlockedBy([result])[0];
      });
    }),

  listBySpecId: publicProcedure
    .input(z.object({ specId: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const rows = db.select().from(tasks).where(eq(tasks.specId, input.specId)).all();
      return attachBlockedBy(rows);
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.id, input.id)).run();
    return { success: true };
  }),
});
