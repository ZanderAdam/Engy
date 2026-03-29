import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { dispatchDirList, dispatchFileRead, dispatchFileWrite } from '../../ws/server';
import { resolveRepoDir, sessionIdParam } from './shared';

export const fileRouter = router({
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
        sessionId: sessionIdParam,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchFileRead(dir, input.filePath, ctx.state, input.ref);
    }),

  write: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        content: z.string(),
        sessionId: sessionIdParam,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchFileWrite(dir, input.filePath, input.content, ctx.state);
    }),
});
