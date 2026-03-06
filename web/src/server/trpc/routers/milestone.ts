import { z } from 'zod';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { projects, workspaces } from '../../db/schema';
import { getWorkspaceDir } from '../../engy-dir/init';
import {
  type MilestoneStatus,
  buildMilestoneFrontmatter,
  listMilestones,
  readPlanFile,
  writePlanFile,
  deletePlanFile,
  parseMilestoneFilename,
} from '../../plan/service';

const MILESTONE_STATUS_ORDER = ['planned', 'planning', 'active', 'complete'] as const;

function validateStatusTransition(current: MilestoneStatus, next: MilestoneStatus): void {
  const currentIdx = MILESTONE_STATUS_ORDER.indexOf(current);
  const nextIdx = MILESTONE_STATUS_ORDER.indexOf(next);
  if (nextIdx !== currentIdx + 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `invalid milestone status transition: "${current}" → "${next}"`,
    });
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveProjectDir(projectId: number) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  const specsDir = path.join(getWorkspaceDir(workspace), 'projects');
  const specSlug = project.projectDir ?? project.slug;
  return { specsDir, specSlug };
}

function updateFrontmatter(existing: string, title: string, status: MilestoneStatus, scope?: string): string {
  const frontmatter = buildMilestoneFrontmatter(title, status, scope);
  const bodyMatch = existing.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : '';
  return frontmatter + body;
}

export const milestoneRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const { specsDir, specSlug } = resolveProjectDir(input.projectId);
      return listMilestones(specsDir, specSlug);
    }),

  get: publicProcedure
    .input(z.object({ projectId: z.number(), filename: z.string() }))
    .query(({ input }) => {
      const { specsDir, specSlug } = resolveProjectDir(input.projectId);
      const milestones = listMilestones(specsDir, specSlug);
      const milestone = milestones.find((m) => m.filename === input.filename);
      if (!milestone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
      return milestone;
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        num: z.number().positive(),
        title: z.string().min(1),
        scope: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { specsDir, specSlug } = resolveProjectDir(input.projectId);
      const filename = `m${input.num}-${slugify(input.title)}.plan.md`;
      const content = buildMilestoneFrontmatter(input.title, 'planned', input.scope);
      writePlanFile(specsDir, specSlug, filename, content);
      return {
        ref: `m${input.num}`,
        num: input.num,
        filename,
        title: input.title,
        status: 'planned' as MilestoneStatus,
        scope: input.scope,
      };
    }),

  update: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        filename: z.string(),
        title: z.string().min(1).optional(),
        status: z.enum(['planned', 'planning', 'active', 'complete']).optional(),
        scope: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { specsDir, specSlug } = resolveProjectDir(input.projectId);
      const milestones = listMilestones(specsDir, specSlug);
      const existing = milestones.find((m) => m.filename === input.filename);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });

      if (input.status) validateStatusTransition(existing.status, input.status);

      const newTitle = input.title ?? existing.title;
      const newStatus = input.status ?? existing.status;
      const newScope = input.scope !== undefined ? input.scope : existing.scope;
      const newFilename = `m${existing.num}-${slugify(newTitle)}.plan.md`;

      const existingContent = readPlanFile(specsDir, specSlug, input.filename) ?? '';
      const newContent = updateFrontmatter(existingContent, newTitle, newStatus, newScope);

      writePlanFile(specsDir, specSlug, newFilename, newContent);
      if (newFilename !== input.filename) {
        deletePlanFile(specsDir, specSlug, input.filename);
      }

      return { ref: existing.ref, num: existing.num, filename: newFilename, title: newTitle, status: newStatus, scope: newScope };
    }),

  delete: publicProcedure
    .input(z.object({ projectId: z.number(), filename: z.string() }))
    .mutation(({ input }) => {
      const { specsDir, specSlug } = resolveProjectDir(input.projectId);
      try {
        deletePlanFile(specsDir, specSlug, input.filename);
      } catch {
        // already gone
      }
      return { success: true };
    }),
});
