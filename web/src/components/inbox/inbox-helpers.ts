import type { RouterOutputs } from '@/lib/trpc';

export type InboxItem = RouterOutputs['inbox']['list'][number];
type InboxEventKind = InboxItem['events'][number]['kind'];
type LatestEvent = NonNullable<InboxItem['latestEvent']>;

const EVENT_VERBS: Record<InboxEventKind, string> = {
  review_requested: 'requested your review',
  mentioned: 'mentioned you',
  commented: 'commented',
  approved: 'approved',
  changes_requested: 'requested changes',
  reviewed: 'reviewed',
  ci_failed: 'CI failed',
  ci_passed: 'CI passed',
  auto_fix_attention: 'auto-fix needs attention',
  merged: 'merged',
  closed: 'closed',
  reopened: 'reopened',
  pushed: 'pushed',
  assigned: 'assigned you',
};

export function summarizeLatestEvent(
  event: Pick<LatestEvent, 'kind' | 'summary' | 'actor'> | null,
): string {
  if (!event) return 'No activity';
  if (!event.actor) return event.summary;
  return `${event.actor} ${EVENT_VERBS[event.kind]}`;
}

export function sortInboxItems<T extends Pick<InboxItem, 'unread' | 'lastEventAt'>>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return b.lastEventAt.localeCompare(a.lastEventAt);
  });
}

export function filterInboxItems<T extends Pick<InboxItem, 'title' | 'repoFullName'>>(
  items: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) || item.repoFullName.toLowerCase().includes(needle),
  );
}

export function moveSelection(
  ids: number[],
  currentId: number | null,
  delta: 1 | -1,
): number | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index === -1) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(Math.max(index + delta, 0), ids.length - 1)];
}

export function nextSelectionAfterRemoval(ids: number[], removedId: number): number | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return null;
  const remaining = ids.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)];
}

export function prKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}
