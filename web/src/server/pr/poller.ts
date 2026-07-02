import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import type { AppState } from '../trpc/context';
import { dispatchGhPrList } from '../ws/server';
import { upsertPrs } from '../trpc/routers/pr';
import { broadcastPrChange } from '../ws/broadcast';

export const POLL_INTERVAL_MS = 60_000;

type Db = ReturnType<typeof getDb>;

export async function runPollCycle(state: AppState, db: Db): Promise<void> {
  if (!state.daemon) return;

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
