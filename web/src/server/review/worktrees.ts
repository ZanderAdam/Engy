import path from 'node:path';
import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { reviewCommentBranch } from '@/lib/diff-doc-path';
import { getDb } from '../db/client';
import { prs, reviewWorktrees, workspaces } from '../db/schema';
import { getReviewWorktreeDir } from '../engy-dir/init';
import { githubRest } from '../github/client';
import { resolveRepoFullName } from '../github/repo-identity';
import { isPathInside } from '../lib/path-inside';
import {
  dispatchGitDeleteRefs,
  dispatchGitFetch,
  dispatchGitResetHard,
  dispatchGitStatus,
  dispatchGitWorktreeList,
  dispatchWorktreeAdd,
  dispatchWorktreeRemove,
} from '../ws/server';
import type { AppState } from '../trpc/context';

export type ReviewWorktreeRow = typeof reviewWorktrees.$inferSelect;
type KeptReason = 'local_changes' | 'session_open';

interface ReviewWorktreeState {
  id: number;
  repoPath: string;
  worktreePath: string;
  headRefName: string;
  headSha: string;
  baseRef: string | null;
  stale: boolean;
  dirty: boolean;
  agentOwned: boolean;
  isCrossRepository: boolean;
  commentBranch: string;
}

interface PrInfo {
  headRefName: string;
  headSha: string | null;
  baseRef: string | null;
  isCrossRepository: boolean;
}

interface GithubPullResponse {
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
}

export const DEFAULT_BASE_REF = 'main';

function reviewBranch(prNumber: number): string {
  return `engy/review/pr-${prNumber}`;
}

function prRef(prNumber: number): string {
  return `refs/engy/pr/${prNumber}`;
}

function reviewRefs(prNumber: number): string[] {
  return [`refs/heads/${reviewBranch(prNumber)}`, prRef(prNumber)];
}

export function keptReason(isDirty: boolean, hasLiveSession: boolean): KeptReason | null {
  if (isDirty) return 'local_changes';
  if (hasLiveSession) return 'session_open';
  return null;
}

export function chooseWorktreesToRemove(
  rows: ReviewWorktreeRow[],
  options: {
    currentId: number;
    isDirty: (row: ReviewWorktreeRow) => boolean;
    hasLiveSession: (row: ReviewWorktreeRow) => boolean;
  },
): ReviewWorktreeRow[] {
  return rows.filter(
    (row) =>
      row.createdByReview &&
      row.id !== options.currentId &&
      keptReason(options.isDirty(row), options.hasLiveSession(row)) === null,
  );
}

function hasLiveSession(state: AppState, worktreePath: string): boolean {
  for (const meta of state.terminalSessionMeta.values()) {
    if (isPathInside(worktreePath, meta.workingDir)) return true;
  }
  return false;
}

async function readDirtyStates(
  state: AppState,
  rows: ReviewWorktreeRow[],
): Promise<Map<number, boolean | null>> {
  const settled = await Promise.allSettled(
    rows.map((row) => dispatchGitStatus(row.worktreePath, state)),
  );
  return new Map(
    rows.map((row, i) => {
      const result = settled[i];
      return [row.id, result.status === 'fulfilled' ? result.value.files.length > 0 : null];
    }),
  );
}

export async function listReviewWorktrees(
  state: AppState,
  workspaceId: number,
): Promise<Array<ReviewWorktreeRow & { kept: KeptReason | null }>> {
  const workspace = getWorkspace(workspaceId);
  const repos = workspace.repos ?? [];
  const rows = getDb()
    .select()
    .from(reviewWorktrees)
    .where(inArray(reviewWorktrees.repoPath, repos))
    .all();
  const reviewCreated = rows.filter((row) => row.createdByReview);
  const dirtyStates = await readDirtyStates(state, reviewCreated);
  return rows.map((row) => ({
    ...row,
    kept: row.createdByReview
      ? keptReason(dirtyStates.get(row.id) === true, hasLiveSession(state, row.worktreePath))
      : null,
  }));
}

function getWorkspace(workspaceId: number) {
  const workspace = getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  return workspace;
}

function getRow(id: number): ReviewWorktreeRow {
  const row = getDb().select().from(reviewWorktrees).where(eq(reviewWorktrees.id, id)).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review worktree not found' });
  return row;
}

export function sameRepoFullName(column: AnyColumn, repoFullName: string): SQL {
  return sql`lower(${column}) = ${repoFullName.toLowerCase()}`;
}

async function findRepo(
  state: AppState,
  repos: string[],
  repoFullName: string,
): Promise<{ repoPath: string; repoFullName: string }> {
  for (const repoPath of repos) {
    const fullName = await resolveRepoFullName(state, repoPath).catch(() => null);
    if (fullName?.toLowerCase() === repoFullName.toLowerCase()) {
      return { repoPath, repoFullName: fullName };
    }
  }
  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `${repoFullName} is not a repo of this workspace`,
  });
}

function findKnownPr(repoPath: string, repoFullName: string, prNumber: number): PrInfo | null {
  const row = getDb()
    .select()
    .from(prs)
    .where(
      and(
        eq(prs.repo, repoPath),
        sameRepoFullName(prs.repoFullName, repoFullName),
        eq(prs.number, prNumber),
      ),
    )
    .get();
  if (!row) return null;
  return {
    headRefName: row.headBranch,
    headSha: row.headSha,
    baseRef: row.baseRef,
    isCrossRepository: row.isCrossRepository,
  };
}

async function resolvePr(
  state: AppState,
  repoPath: string,
  repoFullName: string,
  prNumber: number,
): Promise<PrInfo> {
  const known = findKnownPr(repoPath, repoFullName, prNumber);
  if (known) return known;

  const result = await githubRest<GithubPullResponse>(
    state,
    `/repos/${repoFullName}/pulls/${prNumber}`,
  );
  if (result.status !== 'ok') {
    throw new Error(`GitHub returned no data for ${repoFullName}#${prNumber}`);
  }
  const { head, base } = result.data;
  return {
    headRefName: head.ref,
    headSha: head.sha,
    baseRef: base.ref,
    isCrossRepository: head.repo?.full_name.toLowerCase() !== repoFullName.toLowerCase(),
  };
}

async function readHeadSha(state: AppState, worktreePath: string): Promise<string | null> {
  const status = await dispatchGitStatus(worktreePath, state);
  return status.head ?? null;
}

function fetchPrHead(
  state: AppState,
  repoPath: string,
  prNumber: number,
  baseRef: string | null,
): Promise<unknown> {
  return dispatchGitFetch(
    repoPath,
    `origin/${baseRef ?? DEFAULT_BASE_REF}`,
    state,
    undefined,
    `+refs/pull/${prNumber}/head:${prRef(prNumber)}`,
  );
}

async function findRegisteredWorktree(state: AppState, row: ReviewWorktreeRow) {
  const { worktrees, resolvedPath } = await dispatchGitWorktreeList(
    row.repoPath,
    state,
    undefined,
    row.worktreePath,
  );
  const target = path.resolve(resolvedPath ?? row.worktreePath);
  return worktrees.find((worktree) => path.resolve(worktree.path) === target);
}

async function isWorktreeRegistered(state: AppState, row: ReviewWorktreeRow): Promise<boolean> {
  return (await findRegisteredWorktree(state, row)) !== undefined;
}

async function isRowWorktreeUsable(
  state: AppState,
  row: ReviewWorktreeRow,
  pr: PrInfo,
): Promise<boolean> {
  const entry = await findRegisteredWorktree(state, row);
  if (!entry) return false;
  return row.createdByReview || entry.branch === pr.headRefName;
}

async function removeWorktreeIfPresent(
  state: AppState,
  row: ReviewWorktreeRow,
  force: boolean,
): Promise<void> {
  if (!(await isWorktreeRegistered(state, row))) return;
  await dispatchWorktreeRemove(state, {
    repoDir: row.repoPath,
    worktreePath: row.worktreePath,
    force,
  });
}

async function addReviewWorktree(
  state: AppState,
  args: { repoPath: string; worktreePath: string; prNumber: number },
): Promise<void> {
  await dispatchWorktreeAdd(state, {
    repoDir: args.repoPath,
    worktreePath: args.worktreePath,
    branch: reviewBranch(args.prNumber),
    createBranch: true,
    baseRef: prRef(args.prNumber),
  });
}

async function findAgentWorktree(
  state: AppState,
  repoPath: string,
  headRefName: string,
): Promise<string | null> {
  const { worktrees } = await dispatchGitWorktreeList(repoPath, state);
  const match = worktrees.find((worktree) => !worktree.isMain && worktree.branch === headRefName);
  return match?.path ?? null;
}

function toState(row: ReviewWorktreeRow, pr: PrInfo, flags: Partial<ReviewWorktreeState>) {
  return {
    id: row.id,
    repoPath: row.repoPath,
    worktreePath: row.worktreePath,
    headRefName: row.headRefName,
    headSha: row.headSha,
    baseRef: pr.baseRef,
    stale: false,
    dirty: false,
    agentOwned: !row.createdByReview,
    isCrossRepository: row.isCrossRepository,
    commentBranch: reviewCommentBranch(row),
    ...flags,
  };
}

async function createReviewWorktree(
  state: AppState,
  input: {
    workspace: typeof workspaces.$inferSelect;
    repoPath: string;
    repoFullName: string;
    prNumber: number;
    pr: PrInfo;
  },
): Promise<ReviewWorktreeState> {
  const { workspace, repoPath, repoFullName, prNumber, pr } = input;

  const candidatePath = await findAgentWorktree(state, repoPath, pr.headRefName);
  const agentWorktreePath = candidatePath && !pr.isCrossRepository ? candidatePath : null;
  const createdByReview = agentWorktreePath === null;
  const worktreePath = agentWorktreePath ?? getReviewWorktreeDir(workspace, repoPath, prNumber);

  if (createdByReview) {
    await fetchPrHead(state, repoPath, prNumber, pr.baseRef);
    await addReviewWorktree(state, { repoPath, worktreePath, prNumber });
  }

  try {
    const headSha = createdByReview
      ? ((await readHeadSha(state, worktreePath)) ?? pr.headSha ?? '')
      : (pr.headSha ?? (await readHeadSha(state, worktreePath)) ?? '');
    const row = getDb()
      .insert(reviewWorktrees)
      .values({
        repoPath,
        repoFullName,
        prNumber,
        worktreePath,
        headRefName: pr.headRefName,
        headSha,
        createdByReview,
        isCrossRepository: pr.isCrossRepository,
      })
      .returning()
      .get();
    return toState(row, pr, {});
  } catch (err) {
    if (createdByReview) {
      await removeReviewArtifacts(state, { repoPath, worktreePath, prNumber }).catch(
        (rollbackErr) => console.warn(`[review] rollback failed for ${worktreePath}:`, rollbackErr),
      );
    }
    throw err;
  }
}

async function removeReviewArtifacts(
  state: AppState,
  args: { repoPath: string; worktreePath: string; prNumber: number },
): Promise<void> {
  await dispatchWorktreeRemove(state, {
    repoDir: args.repoPath,
    worktreePath: args.worktreePath,
    force: true,
  });
  await dispatchGitDeleteRefs(args.repoPath, reviewRefs(args.prNumber), state);
}

async function refreshReviewWorktree(
  state: AppState,
  row: ReviewWorktreeRow,
  pr: PrInfo,
  discard: boolean,
): Promise<ReviewWorktreeState> {
  if (!row.createdByReview) {
    return toState(touchRow(row.id, pr, { headSha: pr.headSha ?? row.headSha }), pr, {});
  }

  await fetchPrHead(state, row.repoPath, row.prNumber, pr.baseRef);

  if (discard) return recreateReviewWorktree(state, row, pr);

  const status = await dispatchGitStatus(row.worktreePath, state);
  if (status.files.length > 0) {
    const stale = pr.headSha !== null && pr.headSha !== status.head;
    return toState(touchRow(row.id, pr, {}), pr, { dirty: true, stale });
  }

  await dispatchGitResetHard(row.worktreePath, prRef(row.prNumber), state);
  const headSha = (await readHeadSha(state, row.worktreePath)) ?? row.headSha;
  return toState(touchRow(row.id, pr, { headSha }), pr, {});
}

async function recreateReviewWorktree(
  state: AppState,
  row: ReviewWorktreeRow,
  pr: PrInfo,
): Promise<ReviewWorktreeState> {
  await dispatchWorktreeRemove(state, {
    repoDir: row.repoPath,
    worktreePath: row.worktreePath,
    force: true,
  });
  await dispatchGitDeleteRefs(row.repoPath, [`refs/heads/${reviewBranch(row.prNumber)}`], state);
  try {
    await addReviewWorktree(state, row);
  } catch (err) {
    getDb().delete(reviewWorktrees).where(eq(reviewWorktrees.id, row.id)).run();
    throw err;
  }
  const headSha = (await readHeadSha(state, row.worktreePath)) ?? row.headSha;
  return toState(touchRow(row.id, pr, { headSha }), pr, {});
}

function touchRow(id: number, pr: PrInfo, values: { headSha?: string }): ReviewWorktreeRow {
  return getDb()
    .update(reviewWorktrees)
    .set({
      ...values,
      headRefName: pr.headRefName,
      isCrossRepository: pr.isCrossRepository,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reviewWorktrees.id, id))
    .returning()
    .get();
}

async function deleteReviewWorktree(
  state: AppState,
  row: ReviewWorktreeRow,
  force: boolean,
): Promise<void> {
  await removeWorktreeIfPresent(state, row, force);
  await dispatchGitDeleteRefs(row.repoPath, reviewRefs(row.prNumber), state);
  getDb().delete(reviewWorktrees).where(eq(reviewWorktrees.id, row.id)).run();
}

async function cleanupOtherReviewWorktrees(state: AppState, currentId: number): Promise<void> {
  const candidates = getDb()
    .select()
    .from(reviewWorktrees)
    .all()
    .filter((row) => row.createdByReview && row.id !== currentId);
  const dirtyStates = await readDirtyStates(state, candidates);

  const removable = chooseWorktreesToRemove(candidates, {
    currentId,
    isDirty: (row) => dirtyStates.get(row.id) !== false,
    hasLiveSession: (row) => hasLiveSession(state, row.worktreePath),
  });

  for (const row of removable) {
    try {
      await deleteReviewWorktree(state, row, false);
    } catch (err) {
      console.warn(`[review] cleanup failed for ${row.repoFullName}#${row.prNumber}:`, err);
    }
  }
}

let openQueue: Promise<unknown> = Promise.resolve();

export function openReviewWorktree(
  state: AppState,
  input: { workspaceId: number; repoFullName: string; prNumber: number },
  options: { cleanup: boolean } = { cleanup: true },
): Promise<ReviewWorktreeState> {
  const run = openQueue.then(() => openReviewWorktreeUnqueued(state, input, options));
  openQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function openReviewWorktreeUnqueued(
  state: AppState,
  input: { workspaceId: number; repoFullName: string; prNumber: number },
  options: { cleanup: boolean },
): Promise<ReviewWorktreeState> {
  const { prNumber } = input;
  const workspace = getWorkspace(input.workspaceId);
  const { repoPath, repoFullName } = await findRepo(
    state,
    workspace.repos ?? [],
    input.repoFullName,
  );
  const pr = await resolvePr(state, repoPath, repoFullName, prNumber);

  const existing = getDb()
    .select()
    .from(reviewWorktrees)
    .where(
      and(
        sameRepoFullName(reviewWorktrees.repoFullName, repoFullName),
        eq(reviewWorktrees.prNumber, prNumber),
      ),
    )
    .get();

  let current = existing;
  if (current && !(await isRowWorktreeUsable(state, current, pr))) {
    if (current.createdByReview) {
      await deleteReviewWorktree(state, current, true);
    } else {
      getDb().delete(reviewWorktrees).where(eq(reviewWorktrees.id, current.id)).run();
    }
    current = undefined;
  }

  const result = current
    ? await refreshReviewWorktree(state, current, pr, false)
    : await createReviewWorktree(state, { workspace, repoPath, repoFullName, prNumber, pr });

  if (options.cleanup) {
    try {
      await cleanupOtherReviewWorktrees(state, result.id);
    } catch (err) {
      console.warn('[review] cleanup failed:', err);
    }
  }
  return result;
}

export async function updateReviewWorktree(
  state: AppState,
  id: number,
  options: { discard: boolean },
): Promise<ReviewWorktreeState> {
  const row = getRow(id);
  if (!row.createdByReview) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This worktree belongs to an agent session and cannot be updated by review',
    });
  }
  const pr = await resolvePr(state, row.repoPath, row.repoFullName, row.prNumber);
  return refreshReviewWorktree(state, row, pr, options.discard);
}

export async function removeReviewWorktree(
  state: AppState,
  id: number,
  options: { force: boolean } = { force: false },
): Promise<void> {
  const row = getRow(id);
  if (!row.createdByReview) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This worktree belongs to an agent session and cannot be removed by review',
    });
  }
  await deleteReviewWorktree(state, row, options.force);
}
