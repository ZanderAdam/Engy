import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  getInboxCounts,
  getItem,
  listItems,
  listRecentEvents,
  markAllRead,
  markDone,
  markRead,
  markUnread,
  snooze,
  wakeDueSnoozes,
} from '../../inbox/store';
import { getDb } from '../../db/client';
import { commentThreads, prs, reviewWorktrees } from '../../db/schema';
import { diffScopePrefix } from '../../../lib/diff-doc-path';
import { parseRisk, type ReviewRisk } from '../../../components/diff/review-summary-meta';
import { markThreadDoneOnGithub, markThreadReadOnGithub } from '../../github/notifications';

const RECENT_EVENT_LIMIT = 20;

const filterSchema = z.object({
  tab: z.enum(['priority', 'all']),
  workspaceId: z.number().optional(),
  includeSnoozed: z.boolean().optional(),
});

const itemIdSchema = z.object({ id: z.number() });

function requireItem(id: number) {
  const item = getItem(id);
  if (!item) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Inbox item ${id} not found` });
  }
  return item;
}

function findHeadBranch(repoFullName: string, prNumber: number): string | null {
  const db = getDb();
  const pr = db
    .select({ headBranch: prs.headBranch })
    .from(prs)
    .where(and(eq(prs.repoFullName, repoFullName), eq(prs.number, prNumber)))
    .get();
  if (pr) return pr.headBranch;
  const worktree = db
    .select({ headRefName: reviewWorktrees.headRefName })
    .from(reviewWorktrees)
    .where(
      and(eq(reviewWorktrees.repoFullName, repoFullName), eq(reviewWorktrees.prNumber, prNumber)),
    )
    .get();
  return worktree?.headRefName ?? null;
}

function readReviewRisk(item: {
  repoFullName: string;
  prNumber: number;
  repoPath: string | null;
}): ReviewRisk | null {
  if (!item.repoPath) return null;
  const headBranch = findHeadBranch(item.repoFullName, item.prNumber);
  if (!headBranch) return null;
  const summary = getDb()
    .select({ metadata: commentThreads.metadata })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.documentPath, diffScopePrefix(item.repoPath, headBranch)),
        isNull(commentThreads.workspaceId),
      ),
    )
    .get();
  return parseRisk(summary?.metadata?.risk) ?? null;
}

export const inboxRouter = router({
  list: publicProcedure.input(filterSchema).query(({ input }) => {
    wakeDueSnoozes(new Date());
    return listItems(input).map((item) => {
      const events = listRecentEvents(item.id, RECENT_EVENT_LIMIT);
      const latest = events[0] ?? null;
      return {
        ...item,
        latestEvent: latest && {
          kind: latest.kind,
          summary: latest.summary,
          actor: latest.actor,
          at: latest.at,
        },
        events,
        risk: readReviewRisk(item),
      };
    });
  }),

  counts: publicProcedure.query(() => {
    wakeDueSnoozes(new Date());
    return getInboxCounts();
  }),

  markRead: publicProcedure.input(itemIdSchema).mutation(({ input, ctx }) => {
    const item = requireItem(input.id);
    markRead(item.id);
    if (item.githubThreadId) void markThreadReadOnGithub(ctx.state, item.githubThreadId);
  }),

  markUnread: publicProcedure.input(itemIdSchema).mutation(({ input }) => {
    markUnread(requireItem(input.id).id);
  }),

  markAllRead: publicProcedure.input(filterSchema).mutation(({ input, ctx }) => {
    const threadIds = listItems(input)
      .filter((item) => item.unread && item.githubThreadId)
      .map((item) => item.githubThreadId as string);
    const count = markAllRead(input);
    for (const threadId of threadIds) void markThreadReadOnGithub(ctx.state, threadId);
    return { count };
  }),

  markDone: publicProcedure.input(itemIdSchema).mutation(({ input, ctx }) => {
    const item = requireItem(input.id);
    markDone(item.id);
    if (item.githubThreadId) void markThreadDoneOnGithub(ctx.state, item.githubThreadId);
  }),

  snooze: publicProcedure
    .input(z.object({ id: z.number(), until: z.string().datetime() }))
    .mutation(({ input }) => {
      snooze(requireItem(input.id).id, new Date(input.until));
    }),
});
