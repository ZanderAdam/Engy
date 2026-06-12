import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  dispatchDirList,
  dispatchFileRead,
  dispatchFileWrite,
  dispatchValidation,
  dispatchCreateDir,
  dispatchFsDelete,
  dispatchFsRename,
} from '../../ws/server';

export const fileRouter = router({
  validatePaths: publicProcedure
    .input(
      z.object({
        paths: z.array(z.string().min(1)).min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const results = await dispatchValidation(input.paths, ctx.state);
        return { results };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Path validation failed: ${(err as Error).message}`,
        });
      }
    }),

  home: publicProcedure.query(({ ctx }) => {
    if (!ctx.state.daemon) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No daemon connected' });
    }
    if (ctx.state.daemonHomeDir === null) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Daemon did not report a home directory — update the engy client daemon',
      });
    }
    return { path: ctx.state.daemonHomeDir };
  }),

  listDir: publicProcedure
    .input(
      z.object({
        dirPath: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      return dispatchDirList(input.dirPath, ctx.state);
    }),

  read: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        ref: z.string().optional(),
        worktreePath: z.string().optional(),
        coderWorkspace: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchFileRead(dir, input.filePath, ctx.state, input.ref, input.coderWorkspace);
    }),

  write: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        content: z.string(),
        worktreePath: z.string().optional(),
        coderWorkspace: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchFileWrite(dir, input.filePath, input.content, ctx.state, input.coderWorkspace);
    }),

  createDir: publicProcedure
    .input(
      z.object({
        dirPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await dispatchCreateDir([input.dirPath], ctx.state);
      const entry = result.results.find((r) => r.path === input.dirPath);
      if (entry && !entry.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: entry.error ?? 'Failed to create directory',
        });
      }
      return { success: true };
    }),

  deleteEntry: publicProcedure
    .input(
      z.object({
        rootDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return dispatchFsDelete(input.rootDir, input.relPath, ctx.state);
    }),

  renameEntry: publicProcedure
    .input(
      z.object({
        rootDir: z.string().min(1),
        oldRelPath: z.string().min(1),
        newRelPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return dispatchFsRename(input.rootDir, input.oldRelPath, input.newRelPath, ctx.state);
    }),
});
