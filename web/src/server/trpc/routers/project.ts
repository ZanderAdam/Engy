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
import {
  listProjectFiles,
  getProjectSpec,
  updateProjectSpec,
  listProjectContextFiles,
  readProjectContextFile,
  writeProjectContextFile,
  deleteProjectContextFile,
  readProjectFile,
  writeProjectFile,
  initProjectDir,
  removeProjectDir,
} from '../../project/service';

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

      let projectDir: string | null = null;
      let planSlugs: string[] = [];
      if (workspace && project.projectDir) {
        projectDir = path.join(getWorkspaceDir(workspace), 'projects', project.projectDir);
        const plansDir = path.join(projectDir, 'plans');
        if (existsSync(plansDir)) {
          planSlugs = readdirSync(plansDir)
            .filter((f) => f.endsWith('.plan.md'))
            .map((f) => f.replace(/\.plan\.md$/, ''));
        }
      }

      return { ...project, projectDir, planSlugs };
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
        const projectTasks = db
          .select()
          .from(tasks)
          .where(eq(tasks.projectId, project.id))
          .all();

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
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) return { success: true };

    const workspace = db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();

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
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir)
        return { name: project.slug, type: null, status: null, files: [] as { path: string; mtime: number }[] };

      return listProjectFiles(
        { slug: workspace.slug, docsDir: workspace.docsDir },
        project.projectDir,
      );
    }),

  getSpec: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        return getProjectSpec({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir);
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
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        return updateProjectSpec(
          { slug: workspace.slug, docsDir: workspace.docsDir },
          project.projectDir,
          { title: input.title, status: input.status, body: input.body },
        );
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
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string(), filePath: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        return { content: readProjectFile({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir, input.filePath) };
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
        filePath: z.string().min(1).refine((p) => p !== 'spec.md', {
          message: 'Use project.updateSpec to modify spec.md',
        }),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        writeProjectFile({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir, input.filePath, input.content);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),

  listContextFiles: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) return [];

      return listProjectContextFiles({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir);
    }),

  readContextFile: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string(), filename: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        return readProjectContextFile({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir, input.filename);
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
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        writeProjectContextFile({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir, input.filename, input.content);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),

  deleteContextFile: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), projectSlug: z.string(), filename: z.string() }))
    .mutation(({ input }) => {
      const db = getDb();
      const workspace = getWorkspace(input.workspaceSlug);
      const project = db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, input.projectSlug)))
        .get();
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      if (!project.projectDir) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project has no directory' });

      try {
        deleteProjectContextFile({ slug: workspace.slug, docsDir: workspace.docsDir }, project.projectDir, input.filename);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),
});
