import { fetchNotifications, type GithubNotification } from '../github/notifications';
import { getGithubStatus } from '../github/viewer';
import type { AppState } from '../trpc/context';
import { buildRepoIndex, syncThread } from './inbox-sync';
import { pruneDone, wakeDueSnoozes } from './store';

export const MIN_POLL_INTERVAL_MS = 60_000;
export const MAX_SYNCED_THREADS = 1000;

const IGNORED_REASONS: ReadonlySet<string> = new Set(['ci_activity']);

interface NotificationsSession {
  since: string | null;
  lastModified: string | null;
  pollIntervalMs: number;
  syncedThreads: Map<string, string>;
}

export function createNotificationsSession(): NotificationsSession {
  return {
    since: null,
    lastModified: null,
    pollIntervalMs: MIN_POLL_INTERVAL_MS,
    syncedThreads: new Map(),
  };
}

function needsSync(session: NotificationsSession, thread: GithubNotification): boolean {
  return (
    thread.subject.type === 'PullRequest' &&
    !IGNORED_REASONS.has(thread.reason) &&
    session.syncedThreads.get(thread.id) !== thread.updated_at
  );
}

function logFailure(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[inbox] ${message}: ${detail}`);
}

export async function runNotificationsCycle(
  state: AppState,
  session: NotificationsSession,
  now: Date = new Date(),
): Promise<number> {
  wakeDueSnoozes(now);
  pruneDone(now);

  if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) return session.pollIntervalMs;

  const status = await getGithubStatus(state);
  const viewer = state.github.viewer;
  if (!status.available || !viewer) return session.pollIntervalMs;

  let result;
  try {
    result = await fetchNotifications(state, {
      since: session.since ?? undefined,
      ifModifiedSince: session.since ? (session.lastModified ?? undefined) : undefined,
    });
  } catch (error) {
    logFailure('notifications poll failed', error);
    return session.pollIntervalMs;
  }
  if (result.status === 'not_modified') return session.pollIntervalMs;

  const threads = result.notifications
    .filter((thread) => needsSync(session, thread))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const repoIndex = threads.length > 0 ? await buildRepoIndex(state) : new Map();

  let allSynced = true;
  for (const thread of threads) {
    try {
      await syncThread(
        {
          state,
          viewerLogin: viewer.login,
          repoIndex,
          lastSyncedAt: session.syncedThreads.get(thread.id) ?? null,
        },
        thread,
      );
      session.syncedThreads.delete(thread.id);
      session.syncedThreads.set(thread.id, thread.updated_at);
    } catch (error) {
      allSynced = false;
      logFailure(`inbox sync failed for thread ${thread.id}`, error);
    }
  }

  for (const threadId of session.syncedThreads.keys()) {
    if (session.syncedThreads.size <= MAX_SYNCED_THREADS) break;
    session.syncedThreads.delete(threadId);
  }

  if (allSynced) {
    session.since = now.toISOString();
    session.lastModified = result.lastModified;
  }
  if (result.pollIntervalSeconds !== null) {
    session.pollIntervalMs = Math.max(MIN_POLL_INTERVAL_MS, result.pollIntervalSeconds * 1000);
  }
  return session.pollIntervalMs;
}

export function startNotificationsPoller(state: AppState): () => void {
  const session = createNotificationsSession();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(run, delayMs);
    timer.unref();
  };

  const run = (): void => {
    runNotificationsCycle(state, session)
      .catch((error: unknown) => {
        logFailure('unexpected cycle error', error);
        return session.pollIntervalMs;
      })
      .then(schedule);
  };

  schedule(0);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
