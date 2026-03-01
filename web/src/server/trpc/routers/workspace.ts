import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getDb } from '../../db/client.js';
import { workspaces, projects } from '../../db/schema.js';
import { uniqueWorkspaceSlug } from '../utils.js';
import { initWorkspaceDir, removeWorkspaceDir } from '../../engy-dir/init.js';
import { randomUUID } from 'node:crypto';

export const workspaceRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        repos: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const slug = await uniqueWorkspaceSlug(input.name);

      // Validate repo paths via daemon if repos provided
      if (input.repos.length > 0) {
        if (!ctx.state.daemon || ctx.state.daemon.readyState !== 1) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Client daemon is not running. Start it with: pnpm dev',
          });
        }

        const requestId = randomUUID();
        const validationPromise = new Promise<Array<{ path: string; exists: boolean }>>(
          (resolve, reject) => {
            ctx.state.pendingValidations.set(requestId, { resolve, reject });
            setTimeout(() => {
              ctx.state.pendingValidations.delete(requestId);
              reject(new Error('Path validation timed out after 5 seconds'));
            }, 5000);
          },
        );

        ctx.state.daemon.send(
          JSON.stringify({
            type: 'VALIDATE_PATHS_REQUEST',
            payload: { requestId, paths: input.repos },
          }),
        );

        const results = await validationPromise;
        const invalid = results.filter((r) => !r.exists);
        if (invalid.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid repo paths: ${invalid.map((r) => r.path).join(', ')}`,
            cause: { invalidPaths: invalid.map((r) => r.path) },
          });
        }
      }

      // Insert workspace
      const workspace = db
        .insert(workspaces)
        .values({ name: input.name, slug })
        .returning()
        .get();

      // Initialize filesystem
      try {
        initWorkspaceDir(input.name, slug, input.repos);
      } catch (err) {
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initialize workspace directory: ${(err as Error).message}`,
        });
      }

      // Create default project
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
        removeWorkspaceDir(slug);
        db.delete(workspaces).where(eq(workspaces.id, workspace.id)).run();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create default project: ${(err as Error).message}`,
        });
      }

      // Broadcast WORKSPACES_SYNC to daemon
      if (ctx.state.daemon && ctx.state.daemon.readyState === 1) {
        const allWorkspaces = db.select().from(workspaces).all();
        const syncPayload = allWorkspaces.map((w) => {
          // Read repos from workspace.yaml — for now just pass what was given
          return { slug: w.slug, repos: w.slug === slug ? input.repos : [] };
        });
        ctx.state.daemon.send(
          JSON.stringify({
            type: 'WORKSPACES_SYNC',
            payload: { workspaces: syncPayload },
          }),
        );
      }

      return workspace;
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
    return workspace;
  }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input, ctx }) => {
    const db = getDb();
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
    if (!workspace) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    db.delete(workspaces).where(eq(workspaces.id, input.id)).run();

    try {
      removeWorkspaceDir(workspace.slug);
    } catch (err) {
      console.warn(`[workspace] Failed to remove directory for ${workspace.slug}:`, err);
    }

    // Broadcast WORKSPACES_SYNC to daemon
    if (ctx.state.daemon && ctx.state.daemon.readyState === 1) {
      const allWorkspaces = db.select().from(workspaces).all();
      ctx.state.daemon.send(
        JSON.stringify({
          type: 'WORKSPACES_SYNC',
          payload: { workspaces: allWorkspaces.map((w) => ({ slug: w.slug, repos: [] })) },
        }),
      );
    }

    return { success: true };
  }),
});
