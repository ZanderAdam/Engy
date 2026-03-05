import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { milestones, projects, workspaces } from '../../db/schema';
import { getWorkspaceDir } from '../../engy-dir/init';
import {
  milestoneFilename,
  writePlanFile,
  readPlanFile,
  listPlanFiles,
  deletePlanFile,
} from '../../plan/service';
import path from 'node:path';

function resolveMilestoneContext(milestoneId: number) {
  const db = getDb();
  const milestone = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get();
  if (!milestone) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
  }

  const project = db.select().from(projects).where(eq(projects.id, milestone.projectId)).get();
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }

  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .get();
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }

  return { milestone, project, workspace };
}

export const planContentRouter = router({
  get: publicProcedure
    .input(z.object({ milestoneId: z.number() }))
    .query(({ input }) => {
      const { milestone, project, workspace } = resolveMilestoneContext(input.milestoneId);

      if (!project.projectDir) return null;

      const projectsDir = path.join(getWorkspaceDir(workspace), 'projects');
      const filename = milestoneFilename(milestone.sortOrder, milestone.title);
      const content = readPlanFile(projectsDir, project.projectDir, filename);

      if (content === null) return null;
      return { milestoneId: milestone.id, content };
    }),

  upsert: publicProcedure
    .input(
      z.object({
        milestoneId: z.number(),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const { milestone, project, workspace } = resolveMilestoneContext(input.milestoneId);

      if (!project.projectDir) {
        return { milestoneId: milestone.id, content: input.content, message: 'no projectDir' };
      }

      const projectsDir = path.join(getWorkspaceDir(workspace), 'projects');
      const filename = milestoneFilename(milestone.sortOrder, milestone.title);
      writePlanFile(projectsDir, project.projectDir, filename, input.content);

      return { milestoneId: milestone.id, content: input.content };
    }),

  delete: publicProcedure
    .input(z.object({ milestoneId: z.number() }))
    .mutation(({ input }) => {
      const { milestone, project, workspace } = resolveMilestoneContext(input.milestoneId);

      if (!project.projectDir) return { success: true };

      const projectsDir = path.join(getWorkspaceDir(workspace), 'projects');
      const filename = milestoneFilename(milestone.sortOrder, milestone.title);

      try {
        deletePlanFile(projectsDir, project.projectDir, filename);
      } catch {
        // File doesn't exist — that's fine for delete
      }

      return { success: true };
    }),

  list: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      if (!project.projectDir) return [];

      const workspace = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, project.workspaceId))
        .get();
      if (!workspace) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      const projectsDir = path.join(getWorkspaceDir(workspace), 'projects');
      return listPlanFiles(projectsDir, project.projectDir);
    }),
});
