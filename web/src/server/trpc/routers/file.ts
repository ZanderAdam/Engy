import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { dispatchDirList, dispatchFileRead, dispatchFileWrite } from '../../ws/server';

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
});
