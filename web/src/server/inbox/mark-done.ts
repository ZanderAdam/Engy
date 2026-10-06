import { markThreadDoneOnGithub } from '../github/notifications';
import type { AppState } from '../trpc/context';
import { markDone } from './store';

export async function markItemDone(
  state: AppState,
  item: { id: number; githubThreadId: string | null },
  options: { broadcast?: boolean } = {},
): Promise<boolean> {
  markDone(item.id, new Date(), options.broadcast);
  if (!item.githubThreadId) return true;
  return markThreadDoneOnGithub(state, item.githubThreadId);
}
