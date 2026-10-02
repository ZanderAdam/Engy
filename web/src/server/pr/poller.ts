import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { workspaces, prs, reviewWorktrees } from '../db/schema';
import type { AppState } from '../trpc/context';
import { getViewerTeams } from '../github/teams';
import { getGithubStatus } from '../github/viewer';
import { listOpenPrs, resolveRepoPrs, type GithubPr } from '../github/prs';
import { fetchReviewThreads } from '../github/review-threads';
import {
  upsertPrs,
  findCorrelatedSession,
  recordRepoOutcome,
  type MaterialChange,
} from '../trpc/routers/pr';
import { broadcastPrChange } from '../ws/broadcast';
import { detectFailureTransitions, classifyFailure, isFailingCheck } from './ci-triage';
import { maybeDispatchCiFix } from './auto-fix';
import { syncReviewThreads, type ReviewSyncTarget } from './review-sync';
import { mapPrChange, recordPrInboxEvents, refreshPrFacts } from '../inbox/pr-events';
import { NO_BUCKET_FACTS } from '../inbox/bucket';
import { findItemByPr, upsertItem } from '../inbox/store';

export const POLL_INTERVAL_MS = 60_000;

type Db = ReturnType<typeof getDb>;
type PrRow = typeof prs.$inferSelect;

export async function runPollCycle(state: AppState, db: Db): Promise<void> {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return;

  const status = await getGithubStatus(state);
  if (!status.available) return;

  const allWorkspaces = db.select().from(workspaces).all();

  let openPrs: GithubPr[];
  try {
    openPrs = await listOpenPrs(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const ws of allWorkspaces) {
      for (const repo of ws.repos ?? []) {
        if (state.prRepoErrors.get(repo) !== message) {
          console.error(`[pr-poller] poll failed for ${repo}:`, message);
        }
        recordRepoOutcome(state, repo, message);
      }
    }
    return;
  }

  for (const ws of allWorkspaces) {
    const repos = ws.repos ?? [];

    for (const repo of repos) {
      try {
        const ghPrs = await resolveRepoPrs(state, repo, openPrs);
        recordRepoOutcome(state, repo, null);

        const result = upsertPrs(db, repo, ghPrs);

        if (result.changes.length > 0) {
          broadcastPrChange(ws.id, repo);
        }

        const now = new Date().toISOString();
        for (const change of result.changes) {
          if (change.type === 'ciStatus' && change.current === 'passing') {
            db.update(prs)
              .set({ attentionReason: null, updatedAt: now })
              .where(and(eq(prs.repo, repo), eq(prs.number, change.number)))
              .run();
          }
          // Deleted rows have no other cleanup hook — drop their sync marker
          // or the map grows unbounded with PR churn.
          if (change.type === 'removed') {
            state.prReviewCommentLastSyncedAt.delete(`${repo}#${change.number}`);
          }
        }

        await recordInboxActivity(db, state, ws.id, repo, ghPrs, result.changes);

        const failingTransitions = detectFailureTransitions(result.changes);
        for (const { number } of failingTransitions) {
          void handleFailingPr(db, state, ws, repo, number, ghPrs);
        }

        for (const ghPr of ghPrs) {
          const prUpdatedAt = ghPr.updatedAt ?? null;
          const syncKey = `${repo}#${ghPr.number}`;
          const lastSyncedAt = state.prReviewCommentLastSyncedAt.get(syncKey);
          if (lastSyncedAt !== undefined && prUpdatedAt !== null && lastSyncedAt === prUpdatedAt) {
            continue;
          }
          const prRow = findPrRow(db, repo, ghPr.number);
          if (!prRow || !shouldSyncReviewThreads(db, prRow)) continue;
          void syncPrReviewThreads(db, state, ws.id, prRow, prUpdatedAt);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Log once per distinct error, not on every 60s cycle.
        if (state.prRepoErrors.get(repo) !== message) {
          console.error(`[pr-poller] poll failed for ${repo}:`, message);
        }
        recordRepoOutcome(state, repo, message);
      }
    }
  }
}

function clearPrFacts(change: MaterialChange): void {
  if (!change.repoFullName) return;
  const item = findItemByPr(change.repoFullName, change.number);
  if (!item) return;
  upsertItem({
    repoFullName: item.repoFullName,
    prNumber: item.prNumber,
    title: item.title,
    url: item.url,
    facts: NO_BUCKET_FACTS,
  });
}

async function recordInboxActivity(
  db: Db,
  state: AppState,
  workspaceId: number,
  repo: string,
  ghPrs: GithubPr[],
  changes: MaterialChange[],
): Promise<void> {
  const viewerLogin = state.github.viewer?.login ?? null;
  const viewerTeams = await getViewerTeams(state);
  const rows = db.select().from(prs).where(eq(prs.repo, repo)).all();
  const rowByNumber = new Map(rows.map((row) => [row.number, row]));

  for (const change of changes) {
    if (change.type === 'removed') {
      clearPrFacts(change);
      continue;
    }
    const prRow = rowByNumber.get(change.number);
    if (!prRow) continue;
    const events = mapPrChange(change, prRow);
    recordPrInboxEvents({ prRow, workspaceId, viewerLogin, viewerTeams, events });
  }

  for (const ghPr of ghPrs) {
    const prRow = rowByNumber.get(ghPr.number);
    if (prRow) refreshPrFacts(prRow, viewerLogin, viewerTeams);
  }
}

function findPrRow(db: Db, repo: string, prNumber: number): PrRow | undefined {
  return db
    .select()
    .from(prs)
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .get();
}

function shouldSyncReviewThreads(db: Db, prRow: PrRow): boolean {
  if (findCorrelatedSession(db, prRow.headBranch, prRow.repo)) return true;
  if (!prRow.repoFullName) return false;
  const reviewWorktree = db
    .select({ id: reviewWorktrees.id })
    .from(reviewWorktrees)
    .where(
      and(
        eq(reviewWorktrees.repoFullName, prRow.repoFullName),
        eq(reviewWorktrees.prNumber, prRow.number),
      ),
    )
    .get();
  return reviewWorktree !== undefined;
}

async function importReviewThreads(
  db: Db,
  state: AppState,
  target: ReviewSyncTarget & { repoFullName: string | null },
): Promise<ReturnType<typeof syncReviewThreads>> {
  if (!target.repoFullName) {
    throw new Error(`repo ${target.repo} has no GitHub identity`);
  }
  const threads = await fetchReviewThreads(state, target.repoFullName, target.number);
  return syncReviewThreads(db, target, threads);
}

function findReviewTarget(
  db: Db,
  repoPath: string,
  prNumber: number,
): (ReviewSyncTarget & { repoFullName: string | null }) | undefined {
  const prRow = findPrRow(db, repoPath, prNumber);
  if (prRow) return prRow;
  const worktree = db
    .select()
    .from(reviewWorktrees)
    .where(and(eq(reviewWorktrees.repoPath, repoPath), eq(reviewWorktrees.prNumber, prNumber)))
    .get();
  if (!worktree) return undefined;
  return {
    repo: worktree.repoPath,
    repoFullName: worktree.repoFullName,
    number: worktree.prNumber,
    headBranch: worktree.headRefName,
  };
}

export async function syncReviewThreadsNow(
  state: AppState,
  repoPath: string,
  prNumber: number,
): Promise<void> {
  const db = getDb();
  const target = findReviewTarget(db, repoPath, prNumber);
  if (!target) {
    throw new Error(`PR #${prNumber} has no tracked PR or review worktree for ${repoPath}`);
  }
  await importReviewThreads(db, state, target);
}

async function syncPrReviewThreads(
  db: Db,
  state: AppState,
  workspaceId: number,
  prRow: PrRow,
  prUpdatedAt: string | null,
): Promise<void> {
  try {
    const summary = await importReviewThreads(db, state, prRow);
    if (summary.created + summary.updated > 0) {
      broadcastPrChange(workspaceId, prRow.repo);
    }
    if (prUpdatedAt) {
      state.prReviewCommentLastSyncedAt.set(`${prRow.repo}#${prRow.number}`, prUpdatedAt);
    }
  } catch (err) {
    console.error(
      `[pr-poller] review thread sync failed for ${prRow.repo}#${prRow.number}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function handleFailingPr(
  db: Db,
  state: AppState,
  workspace: typeof workspaces.$inferSelect,
  repo: string,
  prNumber: number,
  ghPrs: GithubPr[],
): Promise<void> {
  const dbRow = db
    .select()
    .from(prs)
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .get();

  if (!dbRow) return;

  const ghPr = ghPrs.find((p) => p.number === prNumber);
  const headSha = ghPr?.headSha ?? null;
  const now = new Date().toISOString();

  const headShaChanged = headSha !== null && headSha !== dbRow.lastFailedHeadSha;
  const updatedPrRow = db
    .update(prs)
    .set({
      lastFailedHeadSha: headSha,
      ...(headShaChanged ? { autoFixAttempts: 0 } : {}),
      updatedAt: now,
    })
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .returning()
    .get();

  if (!updatedPrRow) return;

  const failingChecks = (ghPr?.checks ?? []).filter(isFailingCheck);
  const classification = classifyFailure(failingChecks);
  maybeDispatchCiFix({ state, db, prRow: updatedPrRow, classification, workspace }).catch(
    (err: unknown) => {
      console.error(
        `[pr-poller] auto-fix dispatch failed for ${repo}#${prNumber}:`,
        err instanceof Error ? err.message : String(err),
      );
    },
  );
}

/**
 * Starts the PR poller using a self-scheduling setTimeout chain so that a slow
 * cycle (many repos × dispatch timeout) never overlaps with the next one. The
 * next tick is only scheduled after the current cycle fully settles.
 */
export function startPrPoller(state: AppState, db?: Db): void {
  if (state.prPollerTimer !== null) return;

  const run = (): void => {
    // Guard against stopPrPoller being called before this callback executed.
    if (state.prPollerTimer === null) return;

    runPollCycle(state, db ?? getDb())
      .catch((err: unknown) => {
        console.error('[pr-poller] unexpected cycle error:', err);
      })
      .finally(() => {
        // Only reschedule if the poller hasn't been stopped during this cycle.
        if (state.prPollerTimer === null) return;
        const timer = setTimeout(run, POLL_INTERVAL_MS);
        timer.unref();
        state.prPollerTimer = timer;
      });
  };

  const timer = setTimeout(run, POLL_INTERVAL_MS);
  timer.unref();
  state.prPollerTimer = timer;
}

export function stopPrPoller(state: AppState): void {
  if (state.prPollerTimer !== null) {
    clearTimeout(state.prPollerTimer);
    state.prPollerTimer = null;
  }
}
