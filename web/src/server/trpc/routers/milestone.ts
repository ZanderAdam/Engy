import { z } from 'zod';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { projects, workspaces } from '../../db/schema';
import { getWorkspaceDir } from '../../engy-dir/init';
import { resolveEffectiveWorkspace } from '../../engy-dir/effective';
import type { AppState } from '../context';
import {
  type MilestoneStatus,
  buildMilestoneFrontmatter,
  listMilestones,
  readPlanFile,
  writePlanFile,
  planFileExists,
  deletePlanFile,
  slugify,
} from '../../plan/service';

const MILESTONE_STATUS_ORDER = ['planned', 'planning', 'active', 'complete'] as const;

function validateStatusTransition(current: MilestoneStatus, next: MilestoneStatus): void {
  const currentIdx = MILESTONE_STATUS_ORDER.indexOf(current);
  const nextIdx = MILESTONE_STATUS_ORDER.indexOf(next);
  const isForwardStep = nextIdx === currentIdx + 1;
  const isCycleBack = current === 'complete' && next === 'planned';
  if (!isForwardStep && !isCycleBack) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `invalid milestone status transition: "${current}" → "${next}"`,
    });
  }
}

async function resolveProjectDir(
  projectId: number,
  worktreeBranch: string | undefined,
  state: AppState,
) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  const effective = await resolveEffectiveWorkspace(workspace, worktreeBranch, state);
  const specsDir = path.join(getWorkspaceDir(effective), 'projects');
  const specSlug = path.join(project.projectDir ?? project.slug, 'milestones');
  return { specsDir, specSlug };
}

const worktreeBranchSchema = z.string().optional();

function updateFrontmatter(existing: string, title: string, status: MilestoneStatus, scope?: string): string {
  const frontmatter = buildMilestoneFrontmatter(title, status, scope);
  const bodyMatch = existing.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = (bodyMatch ? bodyMatch[1] : existing).replace(/^\n+/, '');
  return frontmatter + '\n' + body;
}

export const milestoneRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.number(), worktreeBranch: worktreeBranchSchema }))
    .query(async ({ input, ctx }) => {
      const { specsDir, specSlug } = await resolveProjectDir(
        input.projectId,
        input.worktreeBranch,
        ctx.state,
      );
      return listMilestones(specsDir, specSlug);
    }),

  get: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        filename: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const { specsDir, specSlug } = await resolveProjectDir(
        input.projectId,
        input.worktreeBranch,
        ctx.state,
      );
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
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { specsDir, specSlug } = await resolveProjectDir(
        input.projectId,
        input.worktreeBranch,
        ctx.state,
      );

      // Reject duplicate milestone numbers — two files sharing the same m{num} ref
      // makes milestoneRef lookups ambiguous.
      const existing = listMilestones(specsDir, specSlug);
      if (existing.some((m) => m.num === input.num)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Milestone m${input.num} already exists`,
        });
      }

      const filename = `m${input.num}-${slugify(input.title)}.plan.md`;

      // Guard against overwriting an existing file (e.g. same num+title combo).
      if (planFileExists(specsDir, specSlug, filename)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Milestone file "${filename}" already exists`,
        });
      }

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
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { specsDir, specSlug } = await resolveProjectDir(
        input.projectId,
        input.worktreeBranch,
        ctx.state,
      );
      const milestones = listMilestones(specsDir, specSlug);
      const existing = milestones.find((m) => m.filename === input.filename);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });

      if (input.status) validateStatusTransition(existing.status, input.status);

      const newTitle = input.title ?? existing.title;
      const newStatus = input.status ?? existing.status;
      const newScope = input.scope !== undefined ? input.scope : existing.scope;
      const newFilename = input.title
        ? `m${existing.num}-${slugify(input.title)}.plan.md`
        : input.filename;

      const existingContent = readPlanFile(specsDir, specSlug, input.filename) ?? '';
      const newContent = updateFrontmatter(existingContent, newTitle, newStatus, newScope);

      writePlanFile(specsDir, specSlug, newFilename, newContent);
      if (newFilename !== input.filename) {
        deletePlanFile(specsDir, specSlug, input.filename);
      }

      return { ref: existing.ref, num: existing.num, filename: newFilename, title: newTitle, status: newStatus, scope: newScope };
    }),

  delete: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        filename: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { specsDir, specSlug } = await resolveProjectDir(
        input.projectId,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        deletePlanFile(specsDir, specSlug, input.filename);
      } catch {
        // already gone
      }
      return { success: true };
    }),
});
