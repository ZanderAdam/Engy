import { existsSync } from 'node:fs';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { agentSessions, projects, reviewWorktrees, tasks, workspaces } from '../db/schema';
import { resolveProjectDir } from '../engy-dir/init';
import { REVIEW_GUIDE_FILE } from '../project/review-guide';
import { spawnAgentTerminal } from '../terminal-dispatch';
import type { AppState } from '../trpc/context';
import { findCorrelatedSession } from '../trpc/routers/pr';
import { dispatchGitBranchFiles } from '../ws/server';
import { buildReviewPrompt } from '../../lib/review-prompt';
import { openReviewWorktree } from './worktrees';

const AUTO_REVIEW_SPAWNER = 'auto-review';
const DEFAULT_BASE_REF = 'main';
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
  return taskSessions + autoReviews;
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
      groupKey: `worktree:${workspace.slug}`,
      workspaceSlug: workspace.slug,
      cols: 80,
      rows: 24,
    },
    mcpOrigin: `http://localhost:${process.env.PORT ?? '3000'}`,
    agentSettings: workspace.agentSettings,
  });
}

function recordReviewedSha(rowId: number, sha: string | null): void {
  getDb()
    .update(reviewWorktrees)
    .set({ autoReviewedSha: sha })
    .where(eq(reviewWorktrees.id, rowId))
    .run();
}

export async function maybeStartAutoReview(
  state: AppState,
  input: AutoReviewInput,
): Promise<AutoReviewResult> {
  const { workspaceId, repoFullName, prNumber } = input;
  const db = getDb();
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace?.autoReviewOnRequest) return skip('setting-off');

  if (!isOpen(state.daemon) || !isOpen(state.terminalDaemon)) return skip('no-daemon');

  if (countActiveSessions(state, workspace) >= (workspace.maxConcurrency ?? 1)) {
    return skip('concurrency-full');
  }

  let worktree;
  try {
    worktree = await openReviewWorktree(state, { workspaceId, repoFullName, prNumber });
  } catch (err) {
    console.error(`[auto-review] open failed for ${repoFullName}#${prNumber}:`, errorText(err));
    return skip('open-failed');
  }

  const row = db.select().from(reviewWorktrees).where(eq(reviewWorktrees.id, worktree.id)).get();
  if (!row || row.autoReviewedSha === worktree.headSha) return skip('already-reviewed');
  recordReviewedSha(row.id, worktree.headSha);

  try {
    const spawned = await spawnReviewSession(
      state,
      workspace,
      worktree,
      prNumber,
      findCorrelatedGuide(workspace, worktree.repoPath, worktree.headRefName),
    );
    if (!spawned) {
      recordReviewedSha(row.id, null);
      return skip('no-daemon');
    }
    return { started: true, sessionId: spawned.sessionId };
  } catch (err) {
    recordReviewedSha(row.id, null);
    console.error(`[auto-review] start failed for ${repoFullName}#${prNumber}:`, errorText(err));
    return skip('open-failed');
  }
}

export async function startManualReview(
  state: AppState,
  input: AutoReviewInput & { projectSlug?: string },
): Promise<{ sessionId: string }> {
  const { workspaceId, repoFullName, prNumber, projectSlug } = input;
  const workspace = getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });

  if (!isOpen(state.daemon) || !isOpen(state.terminalDaemon)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The Engy daemon is not connected. Start it, then try again.',
    });
  }
  if (countActiveSessions(state, workspace) >= (workspace.maxConcurrency ?? 1)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many agent sessions are running. Finish one, then try again.',
    });
  }

  const worktree = await openReviewWorktree(state, { workspaceId, repoFullName, prNumber });
  const reviewGuide = projectSlug
    ? findGuideBySlug(workspace, projectSlug)
    : findCorrelatedGuide(workspace, worktree.repoPath, worktree.headRefName);
  try {
    const spawned = await spawnReviewSession(state, workspace, worktree, prNumber, reviewGuide);
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
