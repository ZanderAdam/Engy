import { eq, and, isNotNull, gt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { prs, agentSessions, tasks, projects, workspaces } from '../db/schema';
import type { AppState } from '../trpc/context';
import { dispatchExecutionStart } from '../ws/server';
import { buildResumeFlags, buildResumeConfig } from '../trpc/routers/execution';
import { findCorrelatedSession } from '../trpc/routers/pr';
import { buildCiFixPrompt } from '../../lib/shell';
import type { CiFailureClassification, FailedLog } from './ci-triage';

type Db = ReturnType<typeof getDb>;

export type CiFixSkipReason =
  | 'non-mechanical'
  | 'auto-ci-fix-disabled'
  | 'no-daemon'
  | 'uncorrelated'
  | 'concurrency-full'
  | 'attempt-cap'
  | 'no-worktree';

export type CiFixResult =
  | { dispatched: true }
  | { dispatched: false; reason: CiFixSkipReason };

interface MaybeDispatchCiFixInput {
  state: AppState;
  db: Db;
  prRow: typeof prs.$inferSelect;
  classification: CiFailureClassification;
  logs: FailedLog[];
  workspace: typeof workspaces.$inferSelect;
}

function persistAttentionReason(
  db: Db,
  repo: string,
  prNumber: number,
  reason: string,
): void {
  db.update(prs)
    .set({ attentionReason: reason, updatedAt: new Date().toISOString() })
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .run();
}

function clearAttentionReason(db: Db, repo: string, prNumber: number): void {
  db.update(prs)
    .set({ attentionReason: null, updatedAt: new Date().toISOString() })
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .run();
}

export async function maybeDispatchCiFix({
  state,
  db,
  prRow,
  classification,
  logs,
  workspace,
}: MaybeDispatchCiFixInput): Promise<CiFixResult> {
  if (classification !== 'mechanical') {
    persistAttentionReason(db, prRow.repo, prRow.number, 'non-mechanical');
    return { dispatched: false, reason: 'non-mechanical' };
  }

  if (!workspace.autoCiFix) {
    return { dispatched: false, reason: 'auto-ci-fix-disabled' };
  }

  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) {
    return { dispatched: false, reason: 'no-daemon' };
  }

  const session = findCorrelatedSession(db, prRow.headBranch, prRow.repo);
  if (!session) {
    persistAttentionReason(db, prRow.repo, prRow.number, 'uncorrelated');
    return { dispatched: false, reason: 'uncorrelated' };
  }

  const maxConcurrency = workspace.maxConcurrency ?? 1;
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const activeCountResult = db
    .select({ count: sql<number>`count(*)` })
    .from(agentSessions)
    .innerJoin(tasks, eq(agentSessions.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, workspace.id),
        eq(agentSessions.status, 'active'),
        gt(agentSessions.updatedAt, staleThreshold),
        isNotNull(agentSessions.worktreePath),
      ),
    )
    .get();
  const activeCount = activeCountResult?.count ?? 0;
  if (activeCount >= maxConcurrency) {
    return { dispatched: false, reason: 'concurrency-full' };
  }

  if (prRow.autoFixAttempts >= 2) {
    persistAttentionReason(db, prRow.repo, prRow.number, 'attempt-cap');
    return { dispatched: false, reason: 'attempt-cap' };
  }

  if (!session.worktreePath) {
    return { dispatched: false, reason: 'no-worktree' };
  }

  const prompt = buildCiFixPrompt({
    prNumber: prRow.number,
    prTitle: prRow.title,
    repo: prRow.repo,
    headBranch: prRow.headBranch,
    checks: (prRow.checks as Array<{ name: string }>) ?? [],
    logs,
  });

  const flags = [
    ...(session.taskId ? buildResumeFlags(session.taskId, session.sessionId) : []),
    '--resume',
    session.sessionId,
  ];
  const config = session.taskId
    ? buildResumeConfig(session.taskId, session.worktreePath)
    : undefined;

  db.update(prs)
    .set({ autoFixAttempts: prRow.autoFixAttempts + 1, updatedAt: new Date().toISOString() })
    .where(and(eq(prs.repo, prRow.repo), eq(prs.number, prRow.number)))
    .run();

  db.update(agentSessions)
    .set({ status: 'active', completionSummary: null, updatedAt: new Date().toISOString() })
    .where(eq(agentSessions.sessionId, session.sessionId))
    .run();

  try {
    await dispatchExecutionStart(state, session.sessionId, prompt, flags, config);
  } catch (err) {
    db.update(prs)
      .set({ autoFixAttempts: prRow.autoFixAttempts, updatedAt: new Date().toISOString() })
      .where(and(eq(prs.repo, prRow.repo), eq(prs.number, prRow.number)))
      .run();
    db.update(agentSessions)
      .set({ status: session.status as 'stopped', updatedAt: new Date().toISOString() })
      .where(eq(agentSessions.sessionId, session.sessionId))
      .run();
    throw err;
  }

  clearAttentionReason(db, prRow.repo, prRow.number);

  return { dispatched: true };
}
