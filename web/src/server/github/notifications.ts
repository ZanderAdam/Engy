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
): Promise<void> {
  try {
    await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[inbox] GitHub ${action} write-back failed for thread ${threadId}: ${redactSecrets(message)}`,
    );
  }
}

export function markThreadReadOnGithub(state: AppState, threadId: string): Promise<void> {
  return writeBack(
    'mark-read',
    threadId,
    githubRest(state, threadPath(threadId), { method: 'PATCH' }),
  );
}

export function markThreadDoneOnGithub(state: AppState, threadId: string): Promise<void> {
  return writeBack(
    'mark-done',
    threadId,
    githubRest(state, threadPath(threadId), { method: 'DELETE' }),
  );
}
