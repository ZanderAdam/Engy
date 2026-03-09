import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, projects } from '../../db/schema';
import { generateSlug, uniqueWorkspaceSlug } from '../utils';
import {
  initWorkspaceDir,
  removeWorkspaceDir,
  renameWorkspaceDir,
  writeWorkspaceYaml,
  getWorkspaceDir,
} from '../../engy-dir/init';
import { dispatchValidation } from '../../ws/server';
import type { AppState } from '../context';

function broadcastWorkspacesSync(state: AppState): void {
  if (!state.daemon || state.daemon.readyState !== 1) return;

  const db = getDb();
  const allWorkspaces = db.select().from(workspaces).all();
  const syncPayload = allWorkspaces.map((w) => ({
    slug: w.slug,
    repos: (w.repos as string[]) ?? [],
  }));

  state.daemon.send(
    JSON.stringify({
      type: 'WORKSPACES_SYNC',
      payload: { workspaces: syncPayload },
    }),
  );
}

export const workspaceRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        repos: z.array(z.string()).default([]),
        docsDir: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const slug = await uniqueWorkspaceSlug(input.name);

      const pathsToValidate = [
        ...input.repos,
        ...(input.docsDir ? [input.docsDir] : []),
      ];

      if (pathsToValidate.length > 0) {
        try {
          const results = await dispatchValidation(pathsToValidate, ctx.state);
          const invalid = results.filter((r) => !r.exists);
          if (invalid.length > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid paths: ${invalid.map((r) => r.path).join(', ')}`,
              cause: { invalidPaths: invalid.map((r) => r.path) },
            });
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Path validation failed: ${(err as Error).message}`,
          });
        }
      }

      const workspace = db
        .insert(workspaces)
        .values({
          name: input.name,
          slug,
          repos: input.repos,
          docsDir: input.docsDir ?? null,
        })
        .returning()
        .get();

      try {
        initWorkspaceDir(input.name, slug, input.repos, input.docsDir);
      } catch (err) {
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initialize workspace directory: ${(err as Error).message}`,
        });
      }

      try {
        db.insert(projects)
          .values({
            workspaceId: workspace.id,
            name: 'Default',
            slug: 'default',
            isDefault: true,
          })
          .run();
      } catch (err) {
        removeWorkspaceDir(slug, input.docsDir);
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create default project: ${(err as Error).message}`,
        });
      }

      broadcastWorkspacesSync(ctx.state);

      return workspace;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        repos: z.array(z.string()).optional(),
        docsDir: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      const newRepos = input.repos ?? (existing.repos as string[]) ?? [];
      const newDocsDir = input.docsDir !== undefined ? input.docsDir : existing.docsDir;
      const newName = input.name ?? existing.name;
      const newSlug = input.slug ?? existing.slug;

      if (input.slug !== undefined && input.slug !== existing.slug) {
        if (generateSlug(input.slug) !== input.slug) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid slug format. Use lowercase alphanumeric characters and hyphens (e.g., "${generateSlug(input.slug)}").`,
          });
        }
        const conflict = db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get();
        if (conflict) {
          throw new TRPCError({ code: 'CONFLICT', message: `Slug "${input.slug}" is already in use.` });
        }
      }

      const pathsToValidate: string[] = [];
      if (input.repos !== undefined) pathsToValidate.push(...input.repos);
      if (input.docsDir && input.docsDir !== existing.docsDir) {
        pathsToValidate.push(input.docsDir);
      }

      if (pathsToValidate.length > 0) {
        try {
          const results = await dispatchValidation(pathsToValidate, ctx.state);
          const invalid = results.filter((r) => !r.exists);
          if (invalid.length > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid paths: ${invalid.map((r) => r.path).join(', ')}`,
              cause: { invalidPaths: invalid.map((r) => r.path) },
            });
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Path validation failed: ${(err as Error).message}`,
          });
        }
      }

      const updated = db
        .update(workspaces)
        .set({ name: newName, slug: newSlug, repos: newRepos, docsDir: newDocsDir })
        .where(eq(workspaces.id, input.id))
        .returning()
        .get();

      const slugChanged = input.slug !== undefined && input.slug !== existing.slug;
      if (slugChanged && !updated.docsDir) {
        try {
          renameWorkspaceDir(existing.slug, updated.slug);
        } catch (err) {
          db.update(workspaces)
            .set({ slug: existing.slug })
            .where(eq(workspaces.id, input.id))
            .run();
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to rename workspace directory: ${(err as Error).message}`,
          });
        }
      }

      const dir = getWorkspaceDir(updated);
      writeWorkspaceYaml(dir, updated.name, updated.slug, newRepos, updated.docsDir);

      broadcastWorkspacesSync(ctx.state);

      return updated;
    }),

  list: publicProcedure.query(() => {
    const db = getDb();
    return db.select().from(workspaces).all();
  }),

  get: publicProcedure.input(z.object({ slug: z.string() })).query(({ input }) => {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get();
    if (!workspace) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${input.slug}" not found` });
    }
    return { ...workspace, resolvedDir: getWorkspaceDir(workspace) };
  }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input, ctx }) => {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
    if (!workspace) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    db.delete(workspaces).where(eq(workspaces.id, input.id)).run();

    try {
      removeWorkspaceDir(workspace.slug, workspace.docsDir);
    } catch (err) {
      console.warn(`[workspace] Failed to remove directory for ${workspace.slug}:`, err);
    }

    broadcastWorkspacesSync(ctx.state);

    return { success: true };
  }),
});
