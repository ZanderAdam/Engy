import { eq, and, isNotNull, gt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { prs, agentSessions, tasks, projects, workspaces } from '../db/schema';
import type { AppState } from '../trpc/context';
import { dispatchExecutionStart } from '../ws/server';
import { fetchFailedLogs } from '../github/checks';
import { buildResumeFlags, buildResumeConfig } from '../trpc/routers/execution';
import { findCorrelatedSession } from '../trpc/routers/pr';
import { buildCiFixPrompt } from '../../lib/shell';
import { broadcastPrAttention } from '../ws/broadcast';
import { mapAttention, recordPrInboxEvents } from '../inbox/pr-events';
import type { CiFailureClassification, FailedLog } from './ci-triage';

type Db = ReturnType<typeof getDb>;

type CiFixSkipReason =
  | 'non-mechanical'
  | 'auto-ci-fix-disabled'
  | 'no-daemon'
  | 'uncorrelated'
  | 'concurrency-full'
  | 'attempt-cap-sha'
  | 'attempt-cap-total'
  | 'no-worktree';

type CiFixResult =
  | { dispatched: true }
  | { dispatched: false; reason: CiFixSkipReason };

export const MAX_AUTO_FIX_ATTEMPTS = 2;
export const MAX_TOTAL_AUTO_FIX_ATTEMPTS = 5;

interface MaybeDispatchCiFixInput {
  state: AppState;
  db: Db;
  prRow: typeof prs.$inferSelect;
  classification: CiFailureClassification;
  workspace: typeof workspaces.$inferSelect;
}

function clearAttentionReason(db: Db, repo: string, prNumber: number): void {
  db.update(prs)
    .set({ attentionReason: null, updatedAt: new Date().toISOString() })
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .run();
}

function setAttentionReason(
  db: Db,
  state: AppState,
  workspace: typeof workspaces.$inferSelect,
  prRow: typeof prs.$inferSelect,
  reason: string,
): void {
  db.update(prs)
    .set({ attentionReason: reason, updatedAt: new Date().toISOString() })
    .where(and(eq(prs.repo, prRow.repo), eq(prs.number, prRow.number)))
    .run();
  broadcastPrAttention(workspace.id, prRow.repo, prRow.number, reason);
  const updatedRow = { ...prRow, attentionReason: reason };
  recordPrInboxEvents({
    prRow: updatedRow,
    workspaceId: workspace.id,
    viewerLogin: state.github.viewer?.login ?? null,
    events: mapAttention(updatedRow, reason),
  });
}

export async function maybeDispatchCiFix({
  state,
  db,
  prRow,
  classification,
  workspace,
}: MaybeDispatchCiFixInput): Promise<CiFixResult> {
  if (classification !== 'mechanical') {
    setAttentionReason(db, state, workspace, prRow, 'non-mechanical');
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
    setAttentionReason(db, state, workspace, prRow, 'uncorrelated');
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

  if (prRow.autoFixTotalAttempts >= MAX_TOTAL_AUTO_FIX_ATTEMPTS) {
    setAttentionReason(db, state, workspace, prRow, 'attempt-cap-total');
    return { dispatched: false, reason: 'attempt-cap-total' };
  }

  if (prRow.autoFixAttempts >= MAX_AUTO_FIX_ATTEMPTS) {
    setAttentionReason(db, state, workspace, prRow, 'attempt-cap-sha');
    return { dispatched: false, reason: 'attempt-cap-sha' };
  }

  if (!session.worktreePath) {
    setAttentionReason(db, state, workspace, prRow, 'no-worktree');
    return { dispatched: false, reason: 'no-worktree' };
  }

  // All gates passed — only now is the (expensive) log fetch worth it. Logs
  // are prompt context only; a failed fetch dispatches with empty logs since
  // the agent can reproduce the failure locally.
  let logs: FailedLog[] = [];
  try {
    if (prRow.repoFullName && prRow.headSha) {
      logs = await fetchFailedLogs(state, prRow.repoFullName, prRow.headSha);
    }
  } catch (err) {
    console.error(
      `[auto-fix] failed to fetch logs for ${prRow.repo}#${prRow.number}:`,
      err instanceof Error ? err.message : String(err),
    );
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

  const prevAutoFixAttempts = prRow.autoFixAttempts;
  const prevAutoFixTotalAttempts = prRow.autoFixTotalAttempts;

  db.update(prs)
    .set({
      autoFixAttempts: prRow.autoFixAttempts + 1,
      autoFixTotalAttempts: prRow.autoFixTotalAttempts + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(prs.repo, prRow.repo), eq(prs.number, prRow.number)))
    .run();

  const prevSessionStatus = session.status;
  db.update(agentSessions)
    .set({ status: 'active', completionSummary: null, updatedAt: new Date().toISOString() })
    .where(eq(agentSessions.sessionId, session.sessionId))
    .run();

  try {
    await dispatchExecutionStart(state, session.sessionId, prompt, flags, config);
  } catch (err) {
    db.update(prs)
      .set({
        autoFixAttempts: prevAutoFixAttempts,
        autoFixTotalAttempts: prevAutoFixTotalAttempts,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(prs.repo, prRow.repo), eq(prs.number, prRow.number)))
      .run();
    db.update(agentSessions)
      .set({ status: prevSessionStatus, updatedAt: new Date().toISOString() })
      .where(eq(agentSessions.sessionId, session.sessionId))
      .run();
    throw err;
  }

  clearAttentionReason(db, prRow.repo, prRow.number);

  return { dispatched: true };
}
