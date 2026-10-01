import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import {
  listReviewWorktrees,
  openReviewWorktree,
  removeReviewWorktree,
  updateReviewWorktree,
} from '../../review/worktrees';

export const reviewRouter = router({
  open: publicProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        repoFullName: z.string().min(1),
        prNumber: z.number().int().positive(),
      }),
    )
    .mutation(({ input, ctx }) => openReviewWorktree(ctx.state, input)),

  update: publicProcedure
    .input(z.object({ id: z.number(), discard: z.boolean().default(false) }))
    .mutation(({ input, ctx }) =>
      updateReviewWorktree(ctx.state, input.id, { discard: input.discard }),
    ),

  remove: publicProcedure
    .input(z.object({ id: z.number(), force: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      await removeReviewWorktree(ctx.state, input.id, { force: input.force });
      return { success: true as const };
    }),

  list: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input, ctx }) => listReviewWorktrees(ctx.state, input.workspaceId)),
});
