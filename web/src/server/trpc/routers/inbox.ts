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
  markRead,
  markUnread,
  notifyInboxChange,
  snooze,
  wakeDueSnoozes,
} from '../../inbox/store';
import { getDb } from '../../db/client';
import { commentThreads, prs, reviewWorktrees } from '../../db/schema';
import { diffScopePrefix, reviewCommentBranch } from '../../../lib/diff-doc-path';
import { parseRisk, type ReviewRisk } from '../../../lib/review-summary-meta';
import { findCorrelatedSession } from './pr';
import { markThreadReadOnGithub } from '../../github/notifications';
import { markItemDone } from '../../inbox/mark-done';
import { buildRepoIndex } from '../../inbox/inbox-sync';
import { fetchReplies } from '../../github/replies';
import { getGithubStatus } from '../../github/viewer';

const RECENT_EVENT_LIMIT = 20;

const filterSchema = z.object({
  tab: z.enum(['priority', 'all']),
  workspaceId: z.number().optional(),
  includeSnoozed: z.boolean().optional(),
});

const bulkSchema = filterSchema.extend({ ids: z.array(z.number()).optional() });

const markAllDoneSchema = bulkSchema.extend({ onlyRead: z.boolean().optional() });

const itemIdSchema = z.object({ id: z.number() });

function requireItem(id: number) {
  const item = getItem(id);
  if (!item) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Inbox item ${id} not found` });
  }
  return item;
}

function findHeadRef(
  repoFullName: string,
  prNumber: number,
): { headBranch: string; isCrossRepository: boolean } | null {
  const db = getDb();
  const pr = db
    .select({ headBranch: prs.headBranch, isCrossRepository: prs.isCrossRepository })
    .from(prs)
    .where(and(eq(prs.repoFullName, repoFullName), eq(prs.number, prNumber)))
    .get();
  if (pr) return pr;
  const worktree = db
    .select({
      headRefName: reviewWorktrees.headRefName,
      isCrossRepository: reviewWorktrees.isCrossRepository,
    })
    .from(reviewWorktrees)
    .where(
      and(eq(reviewWorktrees.repoFullName, repoFullName), eq(reviewWorktrees.prNumber, prNumber)),
    )
    .get();
  if (!worktree) return null;
  return { headBranch: worktree.headRefName, isCrossRepository: worktree.isCrossRepository };
}

function readReviewRisk(
  repoPath: string,
  prNumber: number,
  head: { headBranch: string; isCrossRepository: boolean },
): ReviewRisk | null {
  const branch = reviewCommentBranch({
    headRefName: head.headBranch,
    prNumber,
    isCrossRepository: head.isCrossRepository,
  });
  const summary = getDb()
    .select({ metadata: commentThreads.metadata })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.documentPath, diffScopePrefix(repoPath, branch)),
        isNull(commentThreads.workspaceId),
      ),
    )
    .get();
  return parseRisk(summary?.metadata?.risk) ?? null;
}

function readReviewContext(item: {
  repoFullName: string;
  prNumber: number;
  repoPath: string | null;
}): { risk: ReviewRisk | null; projectSlug: string | null } {
  const noContext = { risk: null, projectSlug: null };
  if (!item.repoPath) return noContext;
  const head = findHeadRef(item.repoFullName, item.prNumber);
  if (!head) return noContext;
  return {
    risk: readReviewRisk(item.repoPath, item.prNumber, head),
    projectSlug:
      findCorrelatedSession(getDb(), { ...head, repo: item.repoPath })?.projectSlug ?? null,
  };
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
        ...readReviewContext(item),
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

  markAllRead: publicProcedure.input(bulkSchema).mutation(({ input, ctx }) => {
    const threadIds = listItems(input)
      .filter((item) => item.unread && item.githubThreadId)
      .map((item) => item.githubThreadId as string);
    const count = markAllRead(input);
    for (const threadId of threadIds) void markThreadReadOnGithub(ctx.state, threadId);
    return { count };
  }),

  markAllDone: publicProcedure.input(markAllDoneSchema).mutation(async ({ input, ctx }) => {
    const { onlyRead, ...filter } = input;
    const items = listItems(filter).filter((item) => !onlyRead || !item.unread);
    const results = items.map((item) => markItemDone(ctx.state, item, { broadcast: false }));
    if (items.length > 0) notifyInboxChange();
    const githubFailures = (await Promise.all(results)).filter((ok) => !ok).length;
    return { count: items.length, githubFailures };
  }),

  markDone: publicProcedure.input(itemIdSchema).mutation(({ input, ctx }) => {
    void markItemDone(ctx.state, requireItem(input.id));
  }),

  replies: publicProcedure
    .input(z.object({ workspaceId: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      const status = await getGithubStatus(ctx.state);
      if (!status.available) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: status.message });
      }
      const [replies, repoIndex] = await Promise.all([
        fetchReplies(ctx.state, status.login),
        buildRepoIndex(ctx.state),
      ]);
      return replies.flatMap((reply) => {
        const workspaceId = repoIndex.get(reply.repoFullName.toLowerCase())?.workspaceId ?? null;
        if (input.workspaceId !== undefined && workspaceId !== input.workspaceId) return [];
        return [{ ...reply, workspaceId }];
      });
    }),

  snooze: publicProcedure
    .input(z.object({ id: z.number(), until: z.string().datetime() }))
    .mutation(({ input }) => {
      snooze(requireItem(input.id).id, new Date(input.until));
    }),
});
