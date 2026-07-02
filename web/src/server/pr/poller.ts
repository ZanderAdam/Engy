import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { workspaces, prs } from '../db/schema';
import type { AppState } from '../trpc/context';
import { dispatchGhPrList, dispatchGhPrFailedLogs, dispatchGhPrReviewComments } from '../ws/server';
import { upsertPrs, findCorrelatedSession } from '../trpc/routers/pr';
import { broadcastPrChange } from '../ws/broadcast';
import { detectFailureTransitions, classifyFailure, isFailingCheck } from './ci-triage';
import { maybeDispatchCiFix } from './auto-fix';
import { syncReviewComments } from './review-sync';

export const POLL_INTERVAL_MS = 60_000;

type Db = ReturnType<typeof getDb>;

export async function runPollCycle(state: AppState, db: Db): Promise<void> {
  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return;

  const allWorkspaces = db.select().from(workspaces).all();

  for (const ws of allWorkspaces) {
    const repos = (ws.repos as string[] | null | undefined) ?? [];
    const coderCfg = ws.coderConfig as { workspace?: string } | null | undefined;
    const coderWorkspace = coderCfg?.workspace;

    for (const repo of repos) {
      try {
        const { prs: ghPrs } = await dispatchGhPrList(repo, state, coderWorkspace);
        state.prPollerErroredRepos.delete(repo);

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
        }

        const failingTransitions = detectFailureTransitions(result.changes);
        for (const { number } of failingTransitions) {
          void handleFailingPr(db, state, ws, repo, number, ghPrs, coderWorkspace);
        }

        // Sync review comments for all open correlated PRs every cycle.
        // Skip when GitHub's updatedAt is unchanged from the last successful sync
        // to avoid an unnecessary gh api call on every tick.
        for (const ghPr of ghPrs) {
          if (ghPr.state !== 'open') continue;
          const prUpdatedAt = ghPr.updatedAt ?? null;
          const syncKey = `${repo}#${ghPr.number}`;
          const lastSyncedAt = state.prReviewCommentLastSyncedAt.get(syncKey);
          if (lastSyncedAt !== undefined && prUpdatedAt !== null && lastSyncedAt === prUpdatedAt) {
            continue;
          }
          const session = findCorrelatedSession(db, ghPr.headBranch, repo);
          if (!session) continue;
          void syncPrReviewComments(db, state, ws.id, repo, ghPr.number, prUpdatedAt, coderWorkspace);
        }
      } catch (err) {
        if (!state.prPollerErroredRepos.has(repo)) {
          console.error(
            `[pr-poller] poll failed for ${repo}:`,
            err instanceof Error ? err.message : String(err),
          );
          state.prPollerErroredRepos.add(repo);
        }
      }
    }
  }
}

async function syncPrReviewComments(
  db: Db,
  state: AppState,
  workspaceId: number,
  repo: string,
  prNumber: number,
  prUpdatedAt: string | null,
  coderWorkspace: string | undefined,
): Promise<void> {
  try {
    const { comments } = await dispatchGhPrReviewComments(repo, prNumber, state, coderWorkspace);
    const prRow = db
      .select()
      .from(prs)
      .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
      .get();
    if (prRow) {
      const summary = syncReviewComments(db, prRow, comments);
      if (summary.created + summary.updated > 0) {
        broadcastPrChange(workspaceId, repo);
      }
    }
    if (prUpdatedAt) {
      state.prReviewCommentLastSyncedAt.set(`${repo}#${prNumber}`, prUpdatedAt);
    }
  } catch (err) {
    console.error(
      `[pr-poller] review comment sync failed for ${repo}#${prNumber}:`,
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
  ghPrs: Awaited<ReturnType<typeof dispatchGhPrList>>['prs'],
  coderWorkspace: string | undefined,
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
  const updatedPrRow = db.update(prs)
    .set({
      lastFailedHeadSha: headSha,
      ...(headShaChanged ? { autoFixAttempts: 0 } : {}),
      updatedAt: now,
    })
    .where(and(eq(prs.repo, repo), eq(prs.number, prNumber)))
    .returning()
    .get();

  if (!updatedPrRow) return;

  let logs: Array<{ checkName: string; excerpt: string }> = [];
  try {
    const result = await dispatchGhPrFailedLogs(repo, prNumber, state, coderWorkspace);
    logs = result.logs;
  } catch (err) {
    console.error(
      `[pr-poller] failed to fetch logs for ${repo}#${prNumber}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const failingChecks = (ghPr?.checks ?? []).filter(isFailingCheck);
  const classification = classifyFailure(failingChecks, logs);
  maybeDispatchCiFix({ state, db, prRow: updatedPrRow, classification, logs, workspace }).catch(
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
