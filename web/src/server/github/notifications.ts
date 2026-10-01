import type { AppState } from '../trpc/context';
import { githubRest } from './client';
import { redactSecrets } from './errors';

function threadPath(threadId: string): string {
  return `/notifications/threads/${encodeURIComponent(threadId)}`;
}

async function writeBack(
  action: string,
  threadId: string,
  request: Promise<unknown>,
): Promise<boolean> {
  try {
    await request;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[inbox] GitHub ${action} write-back failed for thread ${threadId}: ${redactSecrets(message)}`,
    );
    return false;
  }
}

export interface GithubNotification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: { title: string; url: string | null; type: string };
  repository: { full_name: string };
}

type NotificationsFetch =
  | { status: 'not_modified' }
  | {
      status: 'ok';
      notifications: GithubNotification[];
      lastModified: string | null;
      pollIntervalSeconds: number | null;
    };

interface FetchNotificationsOptions {
  since?: string;
  ifModifiedSince?: string;
}

const MAX_NOTIFICATION_PAGES = 10;

export async function fetchNotifications(
  state: AppState,
  options: FetchNotificationsOptions = {},
): Promise<NotificationsFetch> {
  const query = options.since
    ? `all=true&per_page=50&since=${encodeURIComponent(options.since)}`
    : 'all=false&per_page=50';
  const first = await githubRest<GithubNotification[]>(state, `/notifications?${query}`, {
    ifModifiedSince: options.ifModifiedSince,
  });
  if (first.status === 'not_modified') return first;

  const notifications = [...first.data];
  let next = first.nextUrl;
  for (let page = 1; next && page < MAX_NOTIFICATION_PAGES; page++) {
    const result = await githubRest<GithubNotification[]>(state, next);
    if (result.status === 'not_modified') break;
    notifications.push(...result.data);
    next = result.nextUrl;
  }

  const pollHeader = Number(first.headers.get('x-poll-interval'));
  return {
    status: 'ok',
    notifications,
    lastModified: first.lastModified,
    pollIntervalSeconds: Number.isFinite(pollHeader) && pollHeader > 0 ? pollHeader : null,
  };
}

export function markThreadReadOnGithub(state: AppState, threadId: string): Promise<boolean> {
  return writeBack(
    'mark-read',
    threadId,
    githubRest(state, threadPath(threadId), { method: 'PATCH' }),
  );
}

export function markThreadDoneOnGithub(state: AppState, threadId: string): Promise<boolean> {
  return writeBack(
    'mark-done',
    threadId,
    githubRest(state, threadPath(threadId), { method: 'DELETE' }),
  );
}
