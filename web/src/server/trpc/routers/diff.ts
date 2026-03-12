import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { dispatchGitStatus, dispatchGitDiff, dispatchGitLog, dispatchGitShow, dispatchGitBranchFiles } from '../../ws/server';

export const diffRouter = router({
  getStatus: publicProcedure
    .input(z.object({ repoDir: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return dispatchGitStatus(input.repoDir, ctx.state);
    }),

  getFileDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        base: z.string().optional(),
        staged: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const diff = await dispatchGitDiff(
        input.repoDir,
        input.filePath,
        ctx.state,
        input.base,
        input.staged,
      );
      return { diff };
    }),

  getLog: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        maxCount: z.number().min(1).max(200).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return dispatchGitLog(input.repoDir, ctx.state, input.maxCount);
    }),

  getCommitDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        commitHash: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      return dispatchGitShow(input.repoDir, input.commitHash, ctx.state);
    }),

  getBranchDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        base: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const { files } = await dispatchGitBranchFiles(input.repoDir, input.base, ctx.state);
        return { files: files.map((f) => ({ ...f, staged: false })) };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid base ref "${input.base}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
});
