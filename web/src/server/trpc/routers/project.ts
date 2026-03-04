import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { projects, milestones, tasks } from '../../db/schema';
import { uniqueProjectSlug } from '../utils';

const PROJECT_STATUS_ORDER = ['planning', 'active', 'completing', 'archived'] as const;

function validateProjectStatusTransition(current: string, next: string): void {
  const currentIdx = PROJECT_STATUS_ORDER.indexOf(current as (typeof PROJECT_STATUS_ORDER)[number]);
  const nextIdx = PROJECT_STATUS_ORDER.indexOf(next as (typeof PROJECT_STATUS_ORDER)[number]);
  if (nextIdx !== currentIdx + 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `invalid status transition: "${current}" → "${next}"`,
    });
  }
}

export const projectRouter = router({
  create: publicProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        name: z.string().min(1),
        specPath: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const slug = uniqueProjectSlug(input.workspaceId, input.name);

      return db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          slug,
          specPath: input.specPath,
        })
        .returning()
        .get();
    }),

  list: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId))
        .all();
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    return project;
  }),

  getBySlug: publicProcedure
    .input(z.object({ workspaceId: z.number(), slug: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.slug, input.slug)))
        .get();
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      return project;
    }),

  listWithProgress: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      const allProjects = db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId))
        .all();

      return allProjects.map((project) => {
        const projectMilestones = db
          .select()
          .from(milestones)
          .where(eq(milestones.projectId, project.id))
          .all();

        const projectTasks = db
          .select()
          .from(tasks)
          .where(eq(tasks.projectId, project.id))
          .all();

        return {
          ...project,
          milestoneCount: projectMilestones.length,
          completedMilestones: projectMilestones.filter((m) => m.status === 'complete').length,
          taskCount: projectTasks.length,
          completedTasks: projectTasks.filter((t) => t.status === 'done').length,
        };
      });
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(['planning', 'active', 'completing', 'archived']),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const existing = db.select().from(projects).where(eq(projects.id, input.id)).get();
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      validateProjectStatusTransition(existing.status, input.status);

      return db
        .update(projects)
        .set({ status: input.status, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()!;
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(projects).where(eq(projects.id, input.id)).run();
    return { success: true };
  }),
});
