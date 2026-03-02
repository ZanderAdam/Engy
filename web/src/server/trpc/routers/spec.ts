import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces } from '../../db/schema';
import { eq } from 'drizzle-orm';
import {
  listSpecs,
  createSpec,
  getSpec,
  updateSpec,
  deleteSpec,
  listContextFiles,
  readContextFile,
  writeContextFile,
  deleteContextFile,
  readSpecFile,
  writeSpecFile,
} from '../../spec/service';

function getWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  }
  return { slug: ws.slug, docsDir: ws.docsDir };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const specRouter = router({
  list: publicProcedure
    .input(z.object({ workspaceSlug: z.string() }))
    .query(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      return listSpecs(ws);
    }),

  get: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string() }))
    .query(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        return getSpec(ws, input.specSlug);
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  create: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        title: z.string().min(1),
        type: z.enum(['buildable', 'vision']).default('buildable'),
      }),
    )
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      return createSpec(ws, input.title, input.type);
    }),

  update: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        specSlug: z.string(),
        title: z.string().optional(),
        status: z.enum(['draft', 'ready', 'approved', 'active', 'completed']).optional(),
        body: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      const { workspaceSlug: _, specSlug, ...updates } = input;
      try {
        return updateSpec(ws, specSlug, updates);
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        if (msg.includes('Invalid status') || msg.includes('incomplete tasks')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg });
      }
    }),

  delete: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string() }))
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        deleteSpec(ws, input.specSlug);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  listContextFiles: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string() }))
    .query(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      return listContextFiles(ws, input.specSlug);
    }),

  readContextFile: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string(), filename: z.string() }))
    .query(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        return readContextFile(ws, input.specSlug, input.filename);
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  writeContextFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        specSlug: z.string(),
        filename: z.string(),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        writeContextFile(ws, input.specSlug, input.filename, input.content);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  deleteContextFile: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string(), filename: z.string() }))
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        deleteContextFile(ws, input.specSlug, input.filename);
        return { success: true };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  readFile: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), specSlug: z.string(), filePath: z.string() }))
    .query(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        return { content: readSpecFile(ws, input.specSlug, input.filePath) };
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: msg });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  writeFile: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string(),
        specSlug: z.string(),
        filePath: z.string().min(1).refine((p) => p !== 'spec.md', { message: 'Use spec.update to modify spec.md' }),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const ws = getWorkspace(input.workspaceSlug);
      try {
        writeSpecFile(ws, input.specSlug, input.filePath, input.content);
        return { success: true };
      } catch (e) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errorMessage(e) });
      }
    }),
});
