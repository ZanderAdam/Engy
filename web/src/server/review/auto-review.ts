import { existsSync } from 'node:fs';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { agentSessions, projects, tasks, workspaces } from '../db/schema';
import { resolveProjectDir } from '../engy-dir/init';
import { REVIEW_GUIDE_FILE } from '../project/review-guide';
import { spawnAgentTerminal } from '../terminal-dispatch';
import type { AppState } from '../trpc/context';
import { findCorrelatedSession } from '../trpc/routers/pr';
import { dispatchGitBranchFiles } from '../ws/server';
import { projectGroupKey, workspaceGroupKey } from '@/components/terminal/group-key';
import { buildReviewPrompt } from '../../lib/review-prompt';
import { DEFAULT_BASE_REF, openReviewWorktree } from './worktrees';

const AUTO_REVIEW_SPAWNER = 'auto-review';
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

type AutoReviewSkipReason =
  | 'setting-off'
  | 'no-daemon'
  | 'concurrency-full'
  | 'already-reviewed'
  | 'open-failed';

type AutoReviewResult =
  | { started: true; sessionId: string }
  | { started: false; reason: AutoReviewSkipReason };

interface AutoReviewInput {
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
}

type Workspace = typeof workspaces.$inferSelect;
type OpenedWorktree = Awaited<ReturnType<typeof openReviewWorktree>>;

function skip(reason: AutoReviewSkipReason): AutoReviewResult {
  return { started: false, reason };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isOpen(socket: AppState['daemon']): boolean {
  return socket !== null && socket !== undefined && socket.readyState === socket.OPEN;
}

function countActiveSessions(state: AppState, workspace: Workspace): number {
  const staleThreshold = new Date(Date.now() - STALE_SESSION_MS).toISOString();
  const taskSessions =
    getDb()
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
      .get()?.count ?? 0;

  let autoReviews = 0;
  for (const meta of state.terminalSessionMeta.values()) {
    if (meta.spawnedBy === AUTO_REVIEW_SPAWNER && meta.workspaceSlug === workspace.slug) {
      autoReviews++;
    }
  }
  return taskSessions + autoReviews + (state.pendingReviewSlots.get(workspace.id) ?? 0);
}

function reserveSlot(state: AppState, workspace: Workspace): boolean {
  if (countActiveSessions(state, workspace) >= (workspace.maxConcurrency ?? 1)) return false;
  state.pendingReviewSlots.set(workspace.id, (state.pendingReviewSlots.get(workspace.id) ?? 0) + 1);
  return true;
}

function releaseSlot(state: AppState, workspace: Workspace): void {
  const remaining = (state.pendingReviewSlots.get(workspace.id) ?? 1) - 1;
  if (remaining > 0) state.pendingReviewSlots.set(workspace.id, remaining);
  else state.pendingReviewSlots.delete(workspace.id);
}

function projectGuidePath(
  workspace: Workspace,
  project: { projectDir: string | null; slug: string } | undefined,
): string | undefined {
  if (!project) return undefined;
  const guidePath = path.join(resolveProjectDir(workspace, project), REVIEW_GUIDE_FILE);
  return existsSync(guidePath) ? guidePath : undefined;
}

function findCorrelatedGuide(
  workspace: Workspace,
  repoPath: string,
  headRefName: string,
): string | undefined {
  const db = getDb();
  const session = findCorrelatedSession(db, headRefName, repoPath);
  if (!session?.taskId) return undefined;
  const project = db
    .select({ projectDir: projects.projectDir, slug: projects.slug })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, session.taskId))
    .get();
  return projectGuidePath(workspace, project);
}

function findGuideBySlug(workspace: Workspace, slug: string): string | undefined {
  const project = getDb()
    .select({ projectDir: projects.projectDir, slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, slug)))
    .get();
  return projectGuidePath(workspace, project);
}

async function spawnReviewSession(
  state: AppState,
  workspace: Workspace,
  worktree: OpenedWorktree,
  prNumber: number,
  reviewGuide: string | undefined,
  projectSlug?: string,
): Promise<{ sessionId: string } | null> {
  const { mergeBase, head } = await dispatchGitBranchFiles(
    worktree.worktreePath,
    `origin/${worktree.baseRef ?? DEFAULT_BASE_REF}`,
    state,
  );
  const prompt = buildReviewPrompt({
    repoDir: worktree.repoPath,
    worktreePath: worktree.worktreePath,
    spec: { kind: 'range', from: mergeBase, to: head },
    reviewGuide,
  });
  return spawnAgentTerminal(state, {
    agentType: 'claude',
    workingDir: worktree.worktreePath,
    description: `Review PR #${prNumber}`,
    prompt,
    spawnedBy: AUTO_REVIEW_SPAWNER,
    callerMeta: {
      scopeType: 'worktree',
      scopeLabel: `PR #${prNumber}`,
      workingDir: worktree.worktreePath,
      groupKey: projectSlug
        ? projectGroupKey(workspace.slug, projectSlug)
        : workspaceGroupKey(workspace.slug),
      workspaceSlug: workspace.slug,
      cols: 80,
      rows: 24,
    },
    mcpOrigin: `http://localhost:${process.env.PORT ?? '3000'}`,
    agentSettings: workspace.agentSettings,
  });
}

export async function maybeStartAutoReview(
  state: AppState,
  input: AutoReviewInput,
): Promise<AutoReviewResult> {
  const workspace = getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .get();
  if (!workspace?.autoReviewOnRequest) return skip('setting-off');

  if (!isOpen(state.daemon) || !isOpen(state.terminalDaemon)) return skip('no-daemon');

  if (!reserveSlot(state, workspace)) return skip('concurrency-full');
  try {
    return await startReservedAutoReview(state, workspace, input);
  } finally {
    releaseSlot(state, workspace);
  }
}

async function startReservedAutoReview(
  state: AppState,
  workspace: Workspace,
  input: AutoReviewInput,
): Promise<AutoReviewResult> {
  const { workspaceId, repoFullName, prNumber } = input;
  let worktree;
  try {
    worktree = await openReviewWorktree(
      state,
      { workspaceId, repoFullName, prNumber },
      { cleanup: false },
    );
  } catch (err) {
    console.error(`[auto-review] open failed for ${repoFullName}#${prNumber}:`, errorText(err));
    return skip('open-failed');
  }

  const reviewedKey = `${repoFullName}#${prNumber}`;
  if (state.autoReviewedShas.get(reviewedKey) === worktree.headSha) return skip('already-reviewed');
  state.autoReviewedShas.set(reviewedKey, worktree.headSha);

  try {
    const spawned = await spawnReviewSession(
      state,
      workspace,
      worktree,
      prNumber,
      findCorrelatedGuide(workspace, worktree.repoPath, worktree.headRefName),
    );
    if (!spawned) {
      state.autoReviewedShas.delete(reviewedKey);
      return skip('no-daemon');
    }
    return { started: true, sessionId: spawned.sessionId };
  } catch (err) {
    state.autoReviewedShas.delete(reviewedKey);
    console.error(`[auto-review] start failed for ${repoFullName}#${prNumber}:`, errorText(err));
    return skip('open-failed');
  }
}

export async function startManualReview(
  state: AppState,
  input: AutoReviewInput & { projectSlug?: string },
): Promise<{ sessionId: string }> {
  const workspace = getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });

  if (!isOpen(state.daemon) || !isOpen(state.terminalDaemon)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The Engy daemon is not connected. Start it, then try again.',
    });
  }
  if (!reserveSlot(state, workspace)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many agent sessions are running. Finish one, then try again.',
    });
  }
  try {
    return await startReservedManualReview(state, workspace, input);
  } finally {
    releaseSlot(state, workspace);
  }
}

async function startReservedManualReview(
  state: AppState,
  workspace: Workspace,
  input: AutoReviewInput & { projectSlug?: string },
): Promise<{ sessionId: string }> {
  const { workspaceId, repoFullName, prNumber, projectSlug } = input;
  const worktree = await openReviewWorktree(
    state,
    { workspaceId, repoFullName, prNumber },
    { cleanup: false },
  );
  const reviewGuide = projectSlug
    ? findGuideBySlug(workspace, projectSlug)
    : findCorrelatedGuide(workspace, worktree.repoPath, worktree.headRefName);
  try {
    const spawned = await spawnReviewSession(
      state,
      workspace,
      worktree,
      prNumber,
      reviewGuide,
      projectSlug,
    );
    if (spawned) return spawned;
  } catch (err) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Could not start the review: ${errorText(err)}`,
      cause: err,
    });
  }
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'The terminal daemon is not connected. Start it, then try again.',
  });
}
