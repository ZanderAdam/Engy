import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  dispatchDirList,
  dispatchFileRead,
  dispatchFileReadImage,
  dispatchFileWrite,
  dispatchValidation,
  dispatchCreateDir,
  dispatchFsDelete,
  dispatchFsRename,
} from '../../ws/server';
import { imageMimeType } from '@/lib/file-types';

/**
 * Identity of the content the caller expects to read back. The reads themselves
 * ignore it: `HEAD` and the working tree name different bytes at different
 * times, so without something that changes when the content does, a client
 * cache keyed on the request would keep serving the first answer forever.
 * Callers pass it for mutable refs and omit it for a commit hash.
 */
const contentIdInput = z.string().optional();

/**
 * Compose rootDir + relPath into an absolute path for the daemon, rejecting
 * escapes. FS_DELETE/FS_RENAME validate on the daemon side; CREATE_DIR is a
 * raw mkdir op (also used with absolute paths by workspace creation), so the
 * containment check for dir creation lives here instead.
 */
function resolveContainedDirPath(rootDir: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Absolute paths not allowed: ${relPath}` });
  }
  const resolved = path.resolve(rootDir, relPath);
  const rel = path.relative(path.resolve(rootDir), resolved);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Path traversal detected: ${relPath}` });
  }
  return resolved;
}

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
      try {
        return await dispatchDirList(input.dirPath, ctx.state);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOENT') || message.toLowerCase().includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Directory not found: ${input.dirPath}`,
          });
        }
        throw err;
      }
    }),

  read: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        ref: z.string().optional(),
        worktreePath: z.string().optional(),
        coderWorkspace: z.string().optional(),
        contentId: contentIdInput,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchFileRead(dir, input.filePath, ctx.state, input.ref, input.coderWorkspace);
    }),

  // Mirrors `read` but returns image bytes (from the working tree or a git ref,
  // via the daemon) as a base64 data URI for previewing in the code/diff viewers.
  readImage: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        ref: z.string().optional(),
        worktreePath: z.string().optional(),
        coderWorkspace: z.string().optional(),
        contentId: contentIdInput,
      }),
    )
    .query(async ({ input, ctx }) => {
      const mime = imageMimeType(input.filePath);
      if (!mime) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Not a supported image: ${input.filePath}`,
        });
      }
      if (!ctx.state.daemon) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No daemon connected' });
      }
      const dir = input.worktreePath ?? input.repoDir;
      const { base64 } = await dispatchFileReadImage(
        dir,
        input.filePath,
        ctx.state,
        input.ref,
        input.coderWorkspace,
      );
      return { dataUri: `data:${mime};base64,${base64}` };
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
        rootDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dirPath = resolveContainedDirPath(input.rootDir, input.relPath);
      const result = await dispatchCreateDir([dirPath], ctx.state);
      const entry = result.results.find((r) => r.path === dirPath);
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
