import path from 'node:path';
import { z } from 'zod';
import { eq, and, inArray, desc, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, prs, agentSessions, taskGroups, tasks, projects } from '../../db/schema';
import { getGithubStatus } from '../../github/viewer';
import { listOpenPrs, resolveRepoPrs, type GithubPr } from '../../github/prs';
import type { AppState } from '../context';

type Db = ReturnType<typeof getDb>;

interface CorrelatedSession {
  sessionId: string;
  taskGroupId: number | null;
  taskId: number | null;
  worktreePath: string;
  branch: string | null;
  status: typeof agentSessions.$inferSelect.status;
  projectSlug: string | null;
}

function isInsideRepo(repo: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(repo), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function listSessionsOnBranches(db: Db, branches: string[]): CorrelatedSession[] {
  if (branches.length === 0) return [];
  const rows = db
    .select({
      sessionId: agentSessions.sessionId,
      taskGroupId: agentSessions.taskGroupId,
      taskId: agentSessions.taskId,
      worktreePath: agentSessions.worktreePath,
      branch: agentSessions.branch,
      status: agentSessions.status,
      groupProjectId: taskGroups.projectId,
      taskProjectId: tasks.projectId,
    })
    .from(agentSessions)
    .leftJoin(taskGroups, eq(agentSessions.taskGroupId, taskGroups.id))
    .leftJoin(tasks, eq(agentSessions.taskId, tasks.id))
    .where(and(isNotNull(agentSessions.worktreePath), inArray(agentSessions.branch, branches)))
    .orderBy(desc(agentSessions.createdAt), desc(agentSessions.id))
    .all();

  const projectIds = new Set<number>();
  for (const row of rows) {
    const projectId = row.groupProjectId ?? row.taskProjectId;
    if (projectId !== null) projectIds.add(projectId);
  }
  const slugById = new Map(
    projectIds.size === 0
      ? []
      : db
          .select({ id: projects.id, slug: projects.slug })
          .from(projects)
          .where(inArray(projects.id, [...projectIds]))
          .all()
          .map((project) => [project.id, project.slug]),
  );

  return rows.flatMap(({ groupProjectId, taskProjectId, worktreePath, ...session }) =>
    worktreePath === null
      ? []
      : [
          {
            ...session,
            worktreePath,
            projectSlug: slugById.get(groupProjectId ?? taskProjectId ?? -1) ?? null,
          },
        ],
  );
}

function matchesPr(session: CorrelatedSession, headBranch: string, repo: string): boolean {
  return session.branch === headBranch && isInsideRepo(repo, session.worktreePath);
}

/**
 * Finds the most recent agent session on a PR branch whose worktree lives inside the repo.
 */
export function findCorrelatedSession(
  db: Db,
  headBranch: string,
  repo: string,
): CorrelatedSession | null {
  return (
    listSessionsOnBranches(db, [headBranch]).find((session) =>
      matchesPr(session, headBranch, repo),
    ) ?? null
  );
}

export interface MaterialChange {
  number: number;
  repo: string;
  type: 'new' | 'ciStatus' | 'reviewDecision' | 'commentCount' | 'removed';
  previous?: string | null;
  current: string;
}

interface UpsertResult {
  inserted: number;
  updated: number;
  removed: number;
  changes: MaterialChange[];
}

/**
 * Upserts PRs for a single repo. The GitHub search returns only open PRs, so rows
 * absent from the fresh list are no longer open and are deleted outright.
 * Returns material changes so callers can decide whether to broadcast.
 * All writes are wrapped in a single transaction for atomicity.
 */
export function upsertPrs(db: Db, repo: string, ghPrs: GithubPr[]): UpsertResult {
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const existing = tx.select().from(prs).where(eq(prs.repo, repo)).all();
    const existingByNumber = new Map(existing.map((pr) => [pr.number, pr]));
    const incomingNumbers = new Set(ghPrs.map((p) => p.number));

    const changes: MaterialChange[] = [];
    let inserted = 0;
    let updated = 0;
    let removed = 0;

    for (const ghPr of ghPrs) {
      const existingPr = existingByNumber.get(ghPr.number);

      if (!existingPr) {
        tx.insert(prs)
          .values({
            repo,
            number: ghPr.number,
            title: ghPr.title,
            url: ghPr.url,
            headBranch: ghPr.headBranch,
            headSha: ghPr.headSha ?? null,
            author: ghPr.author,
            isDraft: ghPr.isDraft,
            ciStatus: ghPr.ciStatus,
            checks: ghPr.checks,
            commentCount: ghPr.commentCount,
            authoredByViewer: ghPr.authoredByViewer,
            reviewDecision: ghPr.reviewDecision,
            repoFullName: ghPr.repoFullName,
            baseRef: ghPr.baseBranch,
            additions: ghPr.additions,
            deletions: ghPr.deletions,
            reviewRequests: ghPr.reviewRequests,
            updatedAt: now,
          })
          .run();
        changes.push({ number: ghPr.number, repo, type: 'new', current: 'open' });
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
        if (existingPr.reviewDecision !== ghPr.reviewDecision) {
          prChanges.push({
            number: ghPr.number,
            repo,
            type: 'reviewDecision',
            previous: existingPr.reviewDecision,
            current: ghPr.reviewDecision ?? '',
          });
        }
        if (existingPr.commentCount !== ghPr.commentCount) {
          prChanges.push({
            number: ghPr.number,
            repo,
            type: 'commentCount',
            previous: String(existingPr.commentCount),
            current: String(ghPr.commentCount),
          });
        }

        tx.update(prs)
          .set({
            title: ghPr.title,
            url: ghPr.url,
            headBranch: ghPr.headBranch,
            headSha: ghPr.headSha ?? null,
            author: ghPr.author,
            isDraft: ghPr.isDraft,
            ciStatus: ghPr.ciStatus,
            checks: ghPr.checks,
            commentCount: ghPr.commentCount,
            authoredByViewer: ghPr.authoredByViewer,
            reviewDecision: ghPr.reviewDecision,
            repoFullName: ghPr.repoFullName,
            baseRef: ghPr.baseBranch,
            additions: ghPr.additions,
            deletions: ghPr.deletions,
            reviewRequests: ghPr.reviewRequests,
            updatedAt: now,
          })
          .where(and(eq(prs.repo, repo), eq(prs.number, ghPr.number)))
          .run();

        changes.push(...prChanges);
        updated++;
      }
    }

    // Delete rows for PRs no longer in the open list (closed or merged on GitHub).
    for (const pr of existing) {
      if (!incomingNumbers.has(pr.number)) {
        tx.delete(prs)
          .where(and(eq(prs.repo, repo), eq(prs.number, pr.number)))
          .run();
        changes.push({ number: pr.number, repo, type: 'removed', current: 'removed' });
        removed++;
      }
    }

    return { inserted, updated, removed, changes };
  });
}

/** Records a repo's latest PR sync outcome in the in-memory error map (cleared on success). */
export function recordRepoOutcome(state: AppState, repo: string, error: string | null): void {
  if (error === null) {
    state.prRepoErrors.delete(repo);
  } else {
    state.prRepoErrors.set(repo, error);
  }
}

function getWorkspaceRepos(workspaceId: number): {
  workspace: typeof workspaces.$inferSelect;
  repos: string[];
} {
  const db = getDb();
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  return { workspace, repos: (workspace.repos as string[] | null | undefined) ?? [] };
}

export const prRouter = router({
  /**
   * Returns open PRs for all workspace repos, ordered by updatedAt desc.
   * Each PR is correlated with the most recent agent session on the same branch
   * whose worktree lives inside the PR's repo.
   */
  list: publicProcedure.input(z.object({ workspaceId: z.number() })).query(({ input, ctx }) => {
    const db = getDb();
    const { repos } = getWorkspaceRepos(input.workspaceId);

    const repoErrors: Record<string, string> = {};
    for (const repo of repos) {
      const error = ctx.state.prRepoErrors.get(repo);
      if (error !== undefined) repoErrors[repo] = error;
    }

    if (repos.length === 0) return { prs: [], repoErrors };

    const openPrs = db
      .select()
      .from(prs)
      .where(inArray(prs.repo, repos))
      .orderBy(desc(prs.updatedAt))
      .all();

    if (openPrs.length === 0) return { prs: [], repoErrors };

    const sessions = listSessionsOnBranches(db, [...new Set(openPrs.map((pr) => pr.headBranch))]);

    return {
      prs: openPrs.map((pr) => {
        const session = sessions.find((candidate) => matchesPr(candidate, pr.headBranch, pr.repo));
        return {
          ...pr,
          sessionId: session?.sessionId ?? null,
          taskGroupId: session?.taskGroupId ?? null,
          worktreePath: session?.worktreePath ?? null,
          projectSlug: session?.projectSlug ?? null,
        };
      }),
      repoErrors,
    };
  }),

  /**
   * Refreshes PRs for all workspace repos from one GitHub search. Each repo
   * upserts independently; failures are recorded in the in-memory per-repo
   * error map that `list` returns. Throws when GitHub is unavailable.
   */
  refresh: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { repos } = getWorkspaceRepos(input.workspaceId);

      const status = await getGithubStatus(ctx.state);
      if (!status.available) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: status.message });
      }

      let openPrs: GithubPr[];
      try {
        openPrs = await listOpenPrs(ctx.state);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return repos.map((repo) => {
          recordRepoOutcome(ctx.state, repo, error);
          return { repo, success: false as const, error };
        });
      }

      return Promise.all(
        repos.map(async (repo) => {
          try {
            const ghPrs = await resolveRepoPrs(ctx.state, repo, openPrs);
            const upsertResult = upsertPrs(db, repo, ghPrs);
            recordRepoOutcome(ctx.state, repo, null);
            return { repo, success: true as const, ...upsertResult };
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            recordRepoOutcome(ctx.state, repo, error);
            return { repo, success: false as const, error };
          }
        }),
      );
    }),
});
