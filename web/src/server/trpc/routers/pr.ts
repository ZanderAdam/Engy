import { z } from 'zod';
import { eq, and, inArray, desc, isNotNull, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, prs, agentSessions, taskGroups, tasks, projects } from '../../db/schema';
import { dispatchGhPrList } from '../../ws/server';
import type { GhPr } from '@engy/common';
import type { AppState } from '../context';

type Db = ReturnType<typeof getDb>;

interface CorrelatedSession {
  sessionId: string;
  taskGroupId: number | null;
  taskId: number | null;
  worktreePath: string | null;
  branch: string | null;
  status: typeof agentSessions.$inferSelect.status;
}

const SESSION_FIELDS = {
  sessionId: agentSessions.sessionId,
  taskGroupId: agentSessions.taskGroupId,
  taskId: agentSessions.taskId,
  worktreePath: agentSessions.worktreePath,
  branch: agentSessions.branch,
  status: agentSessions.status,
  createdAt: agentSessions.createdAt,
};

/**
 * Finds the most recent agent session correlated to a PR branch within a repo.
 * Covers both group-mode sessions (correlated via taskGroup → project → projectDir)
 * and task-mode sessions (taskGroupId null, correlated via task → project → projectDir).
 */
export function findCorrelatedSession(
  db: Db,
  headBranch: string,
  repo: string,
): CorrelatedSession | null {
  const branchAndRepoWhere = and(
    isNotNull(agentSessions.branch),
    eq(agentSessions.branch, headBranch),
    isNotNull(projects.projectDir),
    eq(projects.projectDir, repo),
  );

  const groupSession =
    db
      .select(SESSION_FIELDS)
      .from(agentSessions)
      .innerJoin(taskGroups, eq(agentSessions.taskGroupId, taskGroups.id))
      .innerJoin(projects, eq(taskGroups.projectId, projects.id))
      .where(branchAndRepoWhere)
      .orderBy(desc(agentSessions.createdAt))
      .get() ?? null;

  const taskSession =
    db
      .select(SESSION_FIELDS)
      .from(agentSessions)
      .innerJoin(tasks, eq(agentSessions.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(isNull(agentSessions.taskGroupId), branchAndRepoWhere))
      .orderBy(desc(agentSessions.createdAt))
      .get() ?? null;

  if (!groupSession && !taskSession) return null;

  const winner =
    !groupSession ? taskSession!
    : !taskSession ? groupSession
    : groupSession.createdAt >= taskSession.createdAt ? groupSession
    : taskSession;

  const { createdAt: _createdAt, ...session } = winner;
  return session;
}

export interface MaterialChange {
  number: number;
  repo: string;
  type: 'new' | 'ciStatus' | 'reviewDecision' | 'removed';
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
 * Upserts PRs for a single repo. `gh pr list` returns only open PRs, so rows
 * absent from the fresh list are no longer open and are deleted outright.
 * Returns material changes so callers can decide whether to broadcast.
 * All writes are wrapped in a single transaction for atomicity.
 */
export function upsertPrs(db: Db, repo: string, ghPrs: GhPr[]): UpsertResult {
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
            reviewDecision: ghPr.reviewDecision,
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
            reviewDecision: ghPr.reviewDecision,
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

/** Records a repo's latest gh outcome in the in-memory error map (cleared on success). */
export function recordRepoOutcome(state: AppState, repo: string, error: string | null): void {
  if (error === null) {
    state.prRepoErrors.delete(repo);
  } else {
    state.prRepoErrors.set(repo, error);
  }
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
   * Each PR is correlated with the most recent agent session on the same branch
   * within the same repo (matched via taskGroup → project → projectDir, or
   * task → project → projectDir for task-mode sessions without a taskGroupId).
   */
  list: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input, ctx }) => {
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

      const branches = [...new Set(openPrs.map((pr) => pr.headBranch))];

      const listSessionFields = {
        sessionId: agentSessions.sessionId,
        taskGroupId: agentSessions.taskGroupId,
        worktreePath: agentSessions.worktreePath,
        branch: agentSessions.branch,
        createdAt: agentSessions.createdAt,
        projectDir: projects.projectDir,
      };

      const branchAndRepoFilter = and(
        isNotNull(agentSessions.branch),
        inArray(agentSessions.branch, branches),
        isNotNull(projects.projectDir),
        inArray(projects.projectDir, repos),
      );

      // Group-mode sessions: taskGroup → project
      const groupSessions = db
        .select(listSessionFields)
        .from(agentSessions)
        .innerJoin(taskGroups, eq(agentSessions.taskGroupId, taskGroups.id))
        .innerJoin(projects, eq(taskGroups.projectId, projects.id))
        .where(branchAndRepoFilter)
        .orderBy(desc(agentSessions.createdAt))
        .all();

      // Task-mode sessions (taskGroupId null): task → project
      const taskSessionsList = db
        .select(listSessionFields)
        .from(agentSessions)
        .innerJoin(tasks, eq(agentSessions.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(isNull(agentSessions.taskGroupId), branchAndRepoFilter))
        .orderBy(desc(agentSessions.createdAt))
        .all();

      // Merge both lists; already ordered by createdAt desc — first entry per key wins.
      const allSessions = [...groupSessions, ...taskSessionsList].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );

      // (branch, repo) → most recent session
      const sessionByKey = new Map<string, (typeof allSessions)[0]>();
      for (const session of allSessions) {
        if (session.branch && session.projectDir) {
          const key = `${session.branch}\0${session.projectDir}`;
          if (!sessionByKey.has(key)) {
            sessionByKey.set(key, session);
          }
        }
      }

      return {
        prs: openPrs.map((pr) => {
          const key = `${pr.headBranch}\0${pr.repo}`;
          const session = sessionByKey.get(key);
          return {
            ...pr,
            sessionId: session?.sessionId ?? null,
            taskGroupId: session?.taskGroupId ?? null,
            worktreePath: session?.worktreePath ?? null,
          };
        }),
        repoErrors,
      };
    }),

  /**
   * Refreshes PRs for all workspace repos via dispatchGhPrList per repo.
   * Each repo refreshes independently; failures carry the daemon's typed
   * error ('gh-not-installed' / 'gh-not-authenticated' / raw message) and
   * are recorded in the in-memory per-repo error map that `list` returns.
   */
  refresh: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { workspace, repos } = getWorkspaceRepos(input.workspaceId);
      const coderCfg = workspace.coderConfig as { workspace?: string } | null | undefined;
      const coderWorkspace = coderCfg?.workspace;

      return Promise.all(
        repos.map(async (repo) => {
          try {
            const { prs: ghPrs } = await dispatchGhPrList(repo, ctx.state, coderWorkspace);
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
