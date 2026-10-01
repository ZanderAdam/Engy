import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { reviewWorktrees, workspaces } from '../../db/schema';
import { fetchPrDetail } from '../../github/pr-detail';
import { syncReviewThreadsNow } from '../../pr/poller';
import {
  listReviewWorktrees,
  openReviewWorktree,
  removeReviewWorktree,
  updateReviewWorktree,
} from '../../review/worktrees';

const prInput = z.object({
  workspaceId: z.number(),
  repoFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
});

function assertWorkspaceExists(workspaceId: number): void {
  const workspace = getDb()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
}

export const reviewRouter = router({
  open: publicProcedure
    .input(prInput)
    .mutation(({ input, ctx }) => openReviewWorktree(ctx.state, input)),

  detail: publicProcedure.input(prInput).query(({ input, ctx }) => {
    assertWorkspaceExists(input.workspaceId);
    return fetchPrDetail(ctx.state, input.repoFullName, input.prNumber);
  }),

  syncThreads: publicProcedure.input(prInput).mutation(async ({ input, ctx }) => {
    const row = getDb()
      .select()
      .from(reviewWorktrees)
      .where(
        and(
          eq(reviewWorktrees.repoFullName, input.repoFullName),
          eq(reviewWorktrees.prNumber, input.prNumber),
        ),
      )
      .get();
    if (!row) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Open ${input.repoFullName}#${input.prNumber} for review before syncing threads`,
      });
    }
    await syncReviewThreadsNow(ctx.state, row.repoPath, row.prNumber);
    return { success: true as const };
  }),

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
