import { z } from 'zod';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { tasks, taskDependencies } from '../../db/schema';
import { validateDependencies, attachBlockedBy } from '../../tasks/validation';
import { broadcastTaskChange } from '../../ws/broadcast';
import { taskStatusSchema } from '@/lib/task-status';
import { triggerAutoStart } from './execution';
import { appRouter } from '../root';

const subStatusEnum = z.enum(['planning', 'implementing', 'blocked', 'failed', 'plan_review']);

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
    .mutation(({ input, ctx }) => {
      const db = getDb();
      const { blockedBy: rawBlockedBy, ...values } = input;
      const dedupedBlockedBy = checkedValidateDeps(null, rawBlockedBy);

      const result = db.transaction((tx) => {
        const newTask = tx.insert(tasks).values(values).returning().get();

        for (const blockerId of dedupedBlockedBy) {
          tx.insert(taskDependencies)
            .values({ taskId: newTask.id, blockerTaskId: blockerId })
            .run();
        }

        broadcastTaskChange('created', newTask.id, newTask.projectId ?? undefined);
        return { ...newTask, blockedBy: dedupedBlockedBy };
      });

      if (result.type === 'ai' && result.status === 'todo' && !result.taskGroupId && !result.milestoneRef) {
        const caller = appRouter.createCaller({ state: ctx.state });
        triggerAutoStart(caller, result.id).catch(() => {});
      }

      return result;
    }),

  list: publicProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        milestoneRef: z.string().optional(),
        taskGroupId: z.number().optional(),
        status: taskStatusSchema.optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDb();

      const conditions: SQL[] = [];
      if (input.projectId !== undefined) conditions.push(eq(tasks.projectId, input.projectId));
      if (input.milestoneRef !== undefined)
        conditions.push(eq(tasks.milestoneRef, input.milestoneRef));
      if (input.taskGroupId !== undefined)
        conditions.push(eq(tasks.taskGroupId, input.taskGroupId));
      if (input.status !== undefined) conditions.push(eq(tasks.status, input.status));

      const rows =
        conditions.length > 0
          ? db.select().from(tasks).where(and(...conditions)).all()
          : db.select().from(tasks).all();

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
        status: taskStatusSchema.optional(),
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
    .mutation(({ input, ctx }) => {
      const db = getDb();
      const { id, blockedBy, ...updates } = input;

      const dedupedBlockedBy = blockedBy !== undefined
        ? checkedValidateDeps(id, blockedBy)
        : undefined;

      const previousTask = db.select().from(tasks).where(eq(tasks.id, id)).get();

      const result = db.transaction((tx) => {
        if (dedupedBlockedBy !== undefined) {
          tx.delete(taskDependencies).where(eq(taskDependencies.taskId, id)).run();
          for (const blockerId of dedupedBlockedBy) {
            tx.insert(taskDependencies)
              .values({ taskId: id, blockerTaskId: blockerId })
              .run();
          }
        }

        const updated = tx
          .update(tasks)
          .set({ ...updates, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, id))
          .returning()
          .get();

        if (!updated) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        broadcastTaskChange('updated', updated.id, updated.projectId ?? undefined);
        return attachBlockedBy([updated])[0];
      });

      const typeChangedToAi =
        previousTask &&
        previousTask.type !== 'ai' &&
        result.type === 'ai' &&
        result.status === 'todo' &&
        !result.taskGroupId &&
        !result.milestoneRef;

      if (typeChangedToAi) {
        const caller = appRouter.createCaller({ state: ctx.state });
        triggerAutoStart(caller, result.id).catch(() => {});
      }

      return result;
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
    const task = db.select().from(tasks).where(eq(tasks.id, input.id)).get();
    db.delete(tasks).where(eq(tasks.id, input.id)).run();
    broadcastTaskChange('deleted', input.id, task?.projectId ?? undefined);
    return { success: true };
  }),

  bulkUpdate: publicProcedure
    .input(
      z.object({
        ids: z.array(z.number()),
        milestoneRef: z.string().nullable().optional(),
        taskGroupId: z.number().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { ids, ...updates } = input;
      if (ids.length === 0) return { updated: 0 };

      const db = getDb();
      return db.transaction((tx) => {
        const result = tx
          .update(tasks)
          .set({ ...updates, updatedAt: new Date().toISOString() })
          .where(inArray(tasks.id, ids))
          .returning()
          .all();

        for (const task of result) {
          broadcastTaskChange('updated', task.id, task.projectId ?? undefined);
        }

        return { updated: result.length };
      });
    }),

  bulkDelete: publicProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(({ input }) => {
      if (input.ids.length === 0) return { deleted: 0 };

      const db = getDb();
      return db.transaction((tx) => {
        const toDelete = tx
          .select()
          .from(tasks)
          .where(inArray(tasks.id, input.ids))
          .all();

        if (toDelete.length > 0) {
          tx.delete(tasks).where(inArray(tasks.id, input.ids)).run();
        }

        for (const task of toDelete) {
          broadcastTaskChange('deleted', task.id, task.projectId ?? undefined);
        }

        return { deleted: toDelete.length };
      });
    }),
});
