import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { projects, tasks, workspaces } from '../../db/schema';
import { uniqueProjectSlug } from '../utils';
import { getWorkspaceDir } from '../../engy-dir/init';
import { resolveEffectiveWorkspace } from '../../engy-dir/effective';
import type { AppState } from '../context';
import { projectCompletionService } from '../../services/project-completion';
import {
  listProjectFiles,
  getProjectSpec,
  updateProjectSpec,
  listProjectContextFiles,
  readProjectContextFile,
  writeProjectContextFile,
  deleteProjectContextFile,
  readProjectFile,
  readProjectImage,
  writeProjectFile,
  mkdirProject,
  deleteProjectFile,
  deleteProjectSubDir,
  renameProjectFile,
  renameProjectSubDir,
  initProjectDir,
  removeProjectDir,
} from '../../project/service';
import { isTextPath } from '@/lib/file-types';

function getWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  }
  return ws;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ProjectRow = typeof projects.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;

function readPlanSlugs(projectAbsDir: string): string[] {
  const plansDir = path.join(projectAbsDir, 'plans');
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter((f) => f.endsWith('.plan.md'))
    .map((f) => f.replace(/\.plan\.md$/, ''));
}

function enrichProject(
  project: ProjectRow,
  workspace: WorkspaceRow | undefined,
  effectiveDocsDir?: string | null,
) {
  let projectDir: string | null = null;
  let planSlugs: string[] = [];
  if (workspace && project.projectDir) {
    const effectiveWorkspace =
      effectiveDocsDir !== undefined && effectiveDocsDir !== null
        ? { ...workspace, docsDir: effectiveDocsDir }
        : workspace;
    projectDir = path.join(getWorkspaceDir(effectiveWorkspace), 'projects', project.projectDir);
    planSlugs = readPlanSlugs(projectDir);
  }
  return { ...project, projectDir, planSlugs };
}

const worktreeBranchSchema = z.string().optional();

async function loadProjectForFile(
  workspaceSlug: string,
  projectSlug: string,
  worktreeBranch: string | undefined,
  state: AppState,
): Promise<{
  project: ProjectRow;
  workspace: WorkspaceRow;
  effective: { slug: string; docsDir: string | null };
}> {
  const db = getDb();
  const workspace = getWorkspace(workspaceSlug);
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, projectSlug)))
    .get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  if (!project.projectDir) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });
  }
  const effective = await resolveEffectiveWorkspace(workspace, worktreeBranch, state);
  return { project, workspace, effective };
}

export const projectRouter = router({
  create: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        name: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const slug = uniqueProjectSlug(workspace.id, input.name);

      const project = db
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          name: input.name,
          slug,
          projectDir: slug,
        })
        .returning()
        .get();

      try {
        initProjectDir({ slug: workspace.slug, docsDir: workspace.docsDir }, slug);
      } catch (e) {
        db.delete(projects).where(eq(projects.id, project.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initialize project directory: ${errorMessage(e)}`,
        });
      }

      return project;
    }),

  list: publicProcedure.input(z.object({ workspaceId: z.number() })).query(({ input }) => {
    const db = getDb();
    return db.select().from(projects).where(eq(projects.workspaceId, input.workspaceId)).all();
  }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    return project;
  }),

  getPlanSlugs: publicProcedure
    .input(z.object({ projectId: z.number(), worktreeBranch: worktreeBranchSchema }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      const workspace = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, project.workspaceId))
        .get();
      if (!workspace || !project.projectDir) {
        return { workspaceSlug: workspace?.slug ?? '', planSlugs: [] };
      }
      const effective = await resolveEffectiveWorkspace(workspace, input.worktreeBranch, ctx.state);
      const projectAbsDir = path.join(getWorkspaceDir(effective), 'projects', project.projectDir);
      return { workspaceSlug: workspace.slug, planSlugs: readPlanSlugs(projectAbsDir) };
    }),

  getBySlug: publicProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        slug: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      let project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.slug, input.slug)))
        .get();
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const workspace = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, project.workspaceId))
        .get();

      if (workspace && project.isDefault && !project.projectDir) {
        try {
          const dir = path.join(getWorkspaceDir(workspace), 'projects', project.slug);
          if (!existsSync(dir)) {
            initProjectDir(workspace, project.slug);
          }
          db.update(projects)
            .set({ projectDir: project.slug })
            .where(eq(projects.id, project.id))
            .run();
          project = { ...project, projectDir: project.slug };
        } catch (err) {
          console.warn('[project] Failed to backfill default project dir:', err);
        }
      }

      let effectiveDocsDir: string | null = null;
      if (workspace && input.worktreeBranch) {
        const effective = await resolveEffectiveWorkspace(
          workspace,
          input.worktreeBranch,
          ctx.state,
        );
        effectiveDocsDir = effective.docsDir;
      }
      return enrichProject(project, workspace, effectiveDocsDir);
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
        const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, project.id)).all();

        return {
          ...project,
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

      return db
        .update(projects)
        .set({ status: input.status, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()!;
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) return { success: true };

    const workspace = db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .get();

    db.delete(projects).where(eq(projects.id, input.id)).run();

    if (workspace && project.projectDir) {
      try {
        removeProjectDir({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir);
      } catch {
        // Best-effort filesystem cleanup — DB row already deleted
      }
    }

    return { success: true };
  }),

  // ── Spec file procedures (project-scoped) ────────────────────────

  listFiles: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir)
        return {
          name: project.slug,
          type: null,
          status: null,
          files: [] as { path: string; mtime: number }[],
          dirs: [] as string[],
        };

      const effective = await resolveEffectiveWorkspace(workspace, input.worktreeBranch, ctx.state);
      return listProjectFiles(effective, project.projectDir);
    }),

  getSpec: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        return getProjectSpec(effective, project.projectDir!);
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  updateSpec: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        title: z.string().optional(),
        status: z.enum(['draft', 'ready', 'approved', 'active', 'completed']).optional(),
        body: z.string().optional(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        return updateProjectSpec(effective, project.projectDir!, {
          title: input.title,
          status: input.status,
          body: input.body,
        });
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        if (msg.includes('Invalid status') || msg.includes('incomplete tasks')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg });
      }
    }),

  readFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filePath: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!isTextPath(input.filePath)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is not a readable text file' });
      }
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        return { content: readProjectFile(effective, project.projectDir!, input.filePath) };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  // Mirrors `readFile`'s error mapping (not found → NOT_FOUND, else BAD_REQUEST),
  // but returns image bytes as a base64 data URI for previewing rather than text.
  readImage: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filePath: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        return { dataUri: readProjectImage(effective, project.projectDir!, input.filePath) };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  writeFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filePath: z
          .string()
          .min(1)
          .refine((p) => p !== 'spec.md', {
            message: 'Use project.updateSpec to modify spec.md',
          }),
        content: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        writeProjectFile(effective, project.projectDir!, input.filePath, input.content);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),

  mkdir: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        subDir: z.string().min(1),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        mkdirProject(effective, project.projectDir!, input.subDir);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),

  deleteFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filePath: z
          .string()
          .min(1)
          .refine((p) => p !== 'spec.md', { message: 'Cannot delete spec.md' }),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        deleteProjectFile(effective, project.projectDir!, input.filePath);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  deleteDir: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        subDir: z.string().min(1),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        deleteProjectSubDir(effective, project.projectDir!, input.subDir);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  renameFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        oldPath: z
          .string()
          .min(1)
          .refine((p) => p !== 'spec.md', { message: 'Cannot rename spec.md' }),
        newPath: z.string().min(1),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        renameProjectFile(effective, project.projectDir!, input.oldPath, input.newPath);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        if (msg.includes('already exists')) throw new TRPCError({ code: 'CONFLICT', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  renameDir: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        oldSubDir: z.string().min(1),
        newSubDir: z.string().min(1),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        renameProjectSubDir(effective, project.projectDir!, input.oldSubDir, input.newSubDir);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        if (msg.includes('already exists')) throw new TRPCError({ code: 'CONFLICT', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  listContextFiles: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) return [];

      const effective = await resolveEffectiveWorkspace(workspace, input.worktreeBranch, ctx.state);
      return listProjectContextFiles(effective, project.projectDir);
    }),

  readContextFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filename: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        return readProjectContextFile(effective, project.projectDir!, input.filename);
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  writeContextFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filename: z.string(),
        content: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        writeProjectContextFile(effective, project.projectDir!, input.filename, input.content);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),

  deleteContextFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        projectSlug: z.string(),
        filename: z.string(),
        worktreeBranch: worktreeBranchSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, effective } = await loadProjectForFile(
        input.workspaceSlug,
        input.projectSlug,
        input.worktreeBranch,
        ctx.state,
      );
      try {
        deleteProjectContextFile(effective, project.projectDir!, input.filename);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  // ── Completion flow ──────────────────────────────────────────────

  startCompletion: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(({ input }) => {
      return projectCompletionService.startCompletion(input.projectId);
    }),

  archive: publicProcedure.input(z.object({ projectId: z.number() })).mutation(({ input }) => {
    return projectCompletionService.archive(input.projectId);
  }),
});
