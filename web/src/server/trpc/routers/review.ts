import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import type { AppState } from '../context';
import { getDb } from '../../db/client';
import { reviewWorktrees, workspaces } from '../../db/schema';
import { fetchPrDetail } from '../../github/pr-detail';
import { GithubError } from '../../github/errors';
import {
  addIssueComment,
  draftsToReviewComments,
  fetchPullHeadSha,
  replyToReviewComment,
  setReviewThreadResolved,
  submitReview,
} from '../../github/reviews';
import { markItemDone } from '../../inbox/mark-done';
import { findItemByPr } from '../../inbox/store';
import { syncReviewThreadsNow } from '../../pr/poller';
import { startManualReview } from '../../review/auto-review';
import { requireGithubThread, setResolvedLocally } from '../../review/github-threads';
import { createDraftThread, deleteImportedDrafts, listDraftThreads } from '../../review/drafts';
import {
  listReviewWorktrees,
  openReviewWorktree,
  removeReviewWorktree,
  updateReviewWorktree,
  type ReviewWorktreeRow,
} from '../../review/worktrees';

const prInput = z.object({
  workspaceId: z.number(),
  repoFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
});

function findWorkspace(workspaceId: number) {
  const workspace = getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  return workspace;
}

function requireReviewRow(input: z.infer<typeof prInput>, action: string): ReviewWorktreeRow {
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
  const workspace = findWorkspace(input.workspaceId);
  if (!row || !(workspace.repos ?? []).includes(row.repoPath)) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Open ${input.repoFullName}#${input.prNumber} for review before ${action}`,
    });
  }
  return row;
}

function toTrpcError(error: unknown): unknown {
  if (!(error instanceof GithubError)) return error;
  switch (error.kind) {
    case 'forbidden':
      return new TRPCError({ code: 'FORBIDDEN', message: error.message, cause: error });
    case 'not_found':
      return new TRPCError({ code: 'NOT_FOUND', message: error.message, cause: error });
    case 'validation':
      return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
    default:
      return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message, cause: error });
  }
}

async function rethrowGithubError<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw toTrpcError(error);
  }
}

async function syncAfterWrite(state: AppState, row: ReviewWorktreeRow): Promise<void> {
  try {
    await syncReviewThreadsNow(state, row.repoPath, row.prNumber);
  } catch (error) {
    console.error('[review] thread sync after write failed:', error);
  }
}

const reviewEvent = z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);

export const reviewRouter = router({
  open: publicProcedure
    .input(prInput)
    .mutation(({ input, ctx }) => openReviewWorktree(ctx.state, input)),

  detail: publicProcedure.input(prInput).query(({ input, ctx }) => {
    findWorkspace(input.workspaceId);
    return rethrowGithubError(fetchPrDetail(ctx.state, input.repoFullName, input.prNumber));
  }),

  startAgentReview: publicProcedure
    .input(prInput.extend({ projectSlug: z.string().min(1).optional() }))
    .mutation(({ input, ctx }) => startManualReview(ctx.state, input)),

  syncThreads: publicProcedure.input(prInput).mutation(async ({ input, ctx }) => {
    const row = requireReviewRow(input, 'syncing threads');
    await syncReviewThreadsNow(ctx.state, row.repoPath, row.prNumber);
    return { success: true as const };
  }),

  createDraft: publicProcedure
    .input(
      prInput.extend({
        filePath: z.string().min(1),
        lineNumber: z.number().int().positive(),
        side: z.enum(['modified', 'original']),
        codeLine: z.string(),
        text: z.string().trim().min(1),
      }),
    )
    .mutation(({ input }) => {
      const row = requireReviewRow(input, 'drafting comments');
      return { threadId: createDraftThread(row, input) };
    }),

  submit: publicProcedure
    .input(prInput.extend({ event: reviewEvent, body: z.string().trim() }))
    .mutation(async ({ input, ctx }) => {
      const row = requireReviewRow(input, 'submitting a review');
      const githubHead = await rethrowGithubError(
        fetchPullHeadSha(ctx.state, input.repoFullName, input.prNumber),
      );
      if (githubHead !== row.headSha) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PR changed since you loaded it. Refresh to update.',
        });
      }

      const drafts = listDraftThreads(row);
      const comments = draftsToReviewComments(drafts);
      if (comments.length === 0 && !input.body) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add a draft comment or a review summary before submitting.',
        });
      }
      if (input.event === 'REQUEST_CHANGES' && !input.body) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'GitHub requires a summary when you request changes.',
        });
      }

      await rethrowGithubError(
        submitReview(ctx.state, {
          repoFullName: input.repoFullName,
          prNumber: input.prNumber,
          commitId: githubHead,
          event: input.event,
          body: input.body,
          comments,
        }),
      );

      let remainingDrafts = drafts.length;
      try {
        await syncReviewThreadsNow(ctx.state, row.repoPath, row.prNumber);
        remainingDrafts -= deleteImportedDrafts(row, drafts);
      } catch (error) {
        console.error('[review] thread sync after submit failed:', error);
      }

      const item = findItemByPr(input.repoFullName, input.prNumber);
      if (item) void markItemDone(ctx.state, item);
      return { submitted: comments.length, remainingDrafts };
    }),

  reply: publicProcedure
    .input(prInput.extend({ threadId: z.string(), body: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const row = requireReviewRow(input, 'replying');
      const thread = requireGithubThread(input.threadId, input.prNumber);
      await rethrowGithubError(
        replyToReviewComment(ctx.state, {
          repoFullName: input.repoFullName,
          prNumber: input.prNumber,
          commentId: thread.rootCommentId,
          body: input.body,
        }),
      );
      await syncAfterWrite(ctx.state, row);
      return { success: true as const };
    }),

  comment: publicProcedure
    .input(prInput.extend({ body: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      requireReviewRow(input, 'commenting');
      await rethrowGithubError(
        addIssueComment(ctx.state, {
          repoFullName: input.repoFullName,
          prNumber: input.prNumber,
          body: input.body,
        }),
      );
      return { success: true as const };
    }),

  resolveThread: publicProcedure
    .input(prInput.extend({ threadId: z.string(), resolved: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const row = requireReviewRow(input, 'resolving threads');
      const thread = requireGithubThread(input.threadId, input.prNumber);
      try {
        await setReviewThreadResolved(ctx.state, thread.nodeId, input.resolved);
      } catch (error) {
        if (error instanceof GithubError && error.kind === 'forbidden') {
          setResolvedLocally(thread.row, input.resolved, { localOnly: true });
          return { localOnly: true as const };
        }
        throw toTrpcError(error);
      }
      setResolvedLocally(thread.row, input.resolved, { localOnly: false });
      await syncAfterWrite(ctx.state, row);
      return { localOnly: false as const };
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
