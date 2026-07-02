import { z } from 'zod';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, prs, agentSessions } from '../../db/schema';
import { dispatchGhPrList, dispatchGhAuthStatus } from '../../ws/server';
import type { GhPr } from '@engy/common';

type Db = ReturnType<typeof getDb>;

type PrState = 'open' | 'closed' | 'merged';

interface MaterialChange {
  number: number;
  repo: string;
  type: 'new' | 'ciStatus' | 'state' | 'reviewDecision';
  previous?: string | null;
  current: string;
}

interface UpsertResult {
  inserted: number;
  updated: number;
  closed: number;
  changes: MaterialChange[];
}

function normalizeState(state: string): PrState {
  const lower = state.toLowerCase();
  if (lower === 'open' || lower === 'closed' || lower === 'merged') return lower;
  return 'closed';
}

/**
 * Upserts PRs for a single repo. Marks previously-open rows not present in the
 * fresh list as 'closed'. Returns material changes so callers can decide whether
 * to broadcast.
 */
export function upsertPrs(db: Db, repo: string, ghPrs: GhPr[]): UpsertResult {
  const now = new Date().toISOString();
  const existing = db.select().from(prs).where(eq(prs.repo, repo)).all();
  const existingByNumber = new Map(existing.map((pr) => [pr.number, pr]));
  const incomingNumbers = new Set(ghPrs.map((p) => p.number));

  const changes: MaterialChange[] = [];
  let inserted = 0;
  let updated = 0;
  let closed = 0;

  for (const ghPr of ghPrs) {
    const state = normalizeState(ghPr.state);
    const existingPr = existingByNumber.get(ghPr.number);

    if (!existingPr) {
      db.insert(prs)
        .values({
          repo,
          number: ghPr.number,
          title: ghPr.title,
          url: ghPr.url,
          headBranch: ghPr.headBranch,
          author: ghPr.author,
          isDraft: ghPr.isDraft,
          state,
          ciStatus: ghPr.ciStatus,
          checks: ghPr.checks,
          reviewDecision: ghPr.reviewDecision,
          updatedAt: now,
        })
        .run();
      changes.push({ number: ghPr.number, repo, type: 'new', current: state });
      inserted++;
    } else {
      const prChanges: MaterialChange[] = [];

      if (existingPr.ciStatus !== ghPr.ciStatus) {
        prChanges.push({
          number: ghPr.number,
          repo,
          type: 'ciStatus',
          previous: existingPr.ciStatus,
          current: ghPr.ciStatus,
        });
      }
      if (existingPr.state !== state) {
        prChanges.push({
          number: ghPr.number,
          repo,
          type: 'state',
          previous: existingPr.state,
          current: state,
        });
      }
      if (existingPr.reviewDecision !== ghPr.reviewDecision) {
        prChanges.push({
          number: ghPr.number,
          repo,
          type: 'reviewDecision',
          previous: existingPr.reviewDecision,
          current: ghPr.reviewDecision ?? '',
        });
      }

      db.update(prs)
        .set({
          title: ghPr.title,
          url: ghPr.url,
          headBranch: ghPr.headBranch,
          author: ghPr.author,
          isDraft: ghPr.isDraft,
          state,
          ciStatus: ghPr.ciStatus,
          checks: ghPr.checks,
          reviewDecision: ghPr.reviewDecision,
          updatedAt: now,
        })
        .where(and(eq(prs.repo, repo), eq(prs.number, ghPr.number)))
        .run();

      changes.push(...prChanges);
      updated++;
    }
  }

  // Close previously-open PRs not present in the fresh list.
  for (const pr of existing) {
    if (pr.state === 'open' && !incomingNumbers.has(pr.number)) {
      db.update(prs)
        .set({ state: 'closed', updatedAt: now })
        .where(and(eq(prs.repo, repo), eq(prs.number, pr.number)))
        .run();
      changes.push({ number: pr.number, repo, type: 'state', previous: 'open', current: 'closed' });
      closed++;
    }
  }

  return { inserted, updated, closed, changes };
}

function getWorkspaceRepos(workspaceId: number): { workspace: typeof workspaces.$inferSelect; repos: string[] } {
  const db = getDb();
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  return { workspace, repos: (workspace.repos as string[] | null | undefined) ?? [] };
}

export const prRouter = router({
  /**
   * Returns open PRs for all workspace repos, ordered by updatedAt desc.
   * Each PR is correlated with the most recent agent session on the same branch.
   */
  list: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      const { repos } = getWorkspaceRepos(input.workspaceId);

      if (repos.length === 0) return [];

      const openPrs = db
        .select()
        .from(prs)
        .where(and(eq(prs.state, 'open'), inArray(prs.repo, repos)))
        .orderBy(desc(prs.updatedAt))
        .all();

      if (openPrs.length === 0) return [];

      const branches = [...new Set(openPrs.map((pr) => pr.headBranch))];
      const sessions = db
        .select()
        .from(agentSessions)
        .where(inArray(agentSessions.branch, branches))
        .orderBy(desc(agentSessions.createdAt))
        .all();

      // branch → most recent session (list is already ordered by createdAt desc)
      const sessionByBranch = new Map<string, (typeof sessions)[0]>();
      for (const session of sessions) {
        if (session.branch && !sessionByBranch.has(session.branch)) {
          sessionByBranch.set(session.branch, session);
        }
      }

      return openPrs.map((pr) => {
        const session = sessionByBranch.get(pr.headBranch);
        return {
          ...pr,
          sessionId: session?.sessionId ?? null,
          taskGroupId: session?.taskGroupId ?? null,
          worktreePath: session?.worktreePath ?? null,
        };
      });
    }),

  /**
   * Refreshes PRs for all workspace repos. Calls dispatchGhAuthStatus once per
   * repo, then dispatchGhPrList. Returns per-repo results including typed errors
   * for gh-not-installed / gh-not-authenticated.
   */
  refresh: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { workspace, repos } = getWorkspaceRepos(input.workspaceId);
      const coderCfg = workspace.coderConfig as { workspace?: string } | null | undefined;
      const coderWorkspace = coderCfg?.workspace;

      const results = await Promise.all(
        repos.map(async (repo) => {
          try {
            const { status } = await dispatchGhAuthStatus(ctx.state, coderWorkspace);
            if (!status.ok) {
              const error =
                status.reason === 'not-installed' ? 'gh-not-installed' : 'gh-not-authenticated';
              return { repo, success: false as const, error };
            }

            const { prs: ghPrs } = await dispatchGhPrList(repo, ctx.state, coderWorkspace);
            const upsertResult = upsertPrs(db, repo, ghPrs);
            return { repo, success: true as const, ...upsertResult };
          } catch (err) {
            return {
              repo,
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      return results;
    }),
});
