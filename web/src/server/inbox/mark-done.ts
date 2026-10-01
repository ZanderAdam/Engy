import { markThreadDoneOnGithub } from '../github/notifications';
import type { AppState } from '../trpc/context';
import { markDone } from './store';

export function markItemDone(
  state: AppState,
  item: { id: number; githubThreadId: string | null },
): void {
  markDone(item.id);
  if (item.githubThreadId) void markThreadDoneOnGithub(state, item.githubThreadId);
}
