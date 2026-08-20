import { z } from 'zod';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { taskGroups, projects } from '../../db/schema';
import { nextNumInMilestone } from '../../tasks/task-group-numbering';

export const taskGroupRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        milestoneRef: z.string().optional(),
        name: z.string().min(1),
        repos: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      return db.transaction((tx) => {
        const numInMilestone = nextNumInMilestone(tx, input.projectId, input.milestoneRef);
        return tx
          .insert(taskGroups)
          .values({
            projectId: input.projectId,
            milestoneRef: input.milestoneRef,
            name: input.name,
            repos: input.repos,
            numInMilestone,
          })
          .returning()
          .get();
      });
    }),

  list: publicProcedure
    .input(
      z.object({
        workspaceId: z.number().optional(),
        projectId: z.number().optional(),
        milestoneRef: z.string().nullable().optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDb();
      const conditions: SQL[] = [];
      if (input.projectId !== undefined) conditions.push(eq(taskGroups.projectId, input.projectId));
      if (input.milestoneRef !== undefined) {
        conditions.push(
          input.milestoneRef === null
            ? isNull(taskGroups.milestoneRef)
            : eq(taskGroups.milestoneRef, input.milestoneRef),
        );
      }

      if (input.workspaceId !== undefined) {
        conditions.push(eq(projects.workspaceId, input.workspaceId));
        const rows = db
          .select({ taskGroup: taskGroups })
          .from(taskGroups)
          .innerJoin(projects, eq(taskGroups.projectId, projects.id))
          .where(and(...conditions))
          .all();
        return rows.map((r) => r.taskGroup);
      }

      return conditions.length > 0
        ? db.select().from(taskGroups).where(and(...conditions)).all()
        : db.select().from(taskGroups).all();
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
