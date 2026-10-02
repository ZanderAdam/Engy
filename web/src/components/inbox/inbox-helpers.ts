import type { RouterOutputs } from '@/lib/trpc';

export type InboxItem = RouterOutputs['inbox']['list'][number];

export function githubAvatarUrl(login: string): string {
  return `https://github.com/${login}.png?size=40`;
}

const SNOOZE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatSnoozeUntil(until: string): string {
  return `Snoozed until ${SNOOZE_FORMAT.format(new Date(until)).replace(',', '')}`;
}

export function sortInboxItems<T extends Pick<InboxItem, 'unread' | 'lastEventAt'>>(
  items: T[],
  unreadFirst: boolean,
): T[] {
  return [...items].sort((a, b) => {
    if (unreadFirst && a.unread !== b.unread) return a.unread ? -1 : 1;
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

export function visibleItemIds(
  rows: { item: { id: number; unread: boolean } | null }[],
  onlyRead = false,
): number[] {
  return rows.flatMap(({ item }) => (item && (!onlyRead || !item.unread) ? [item.id] : []));
}

export function moveSelection<K>(ids: K[], currentId: K | null, delta: 1 | -1): K | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index === -1) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(Math.max(index + delta, 0), ids.length - 1)];
}

export function nextSelectionAfterRemoval<K>(ids: K[], removedId: K): K | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return null;
  const remaining = ids.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)];
}

export function selectionAfterMarkRead<K>(
  explicitId: K | null,
  rowId: K,
  wasUnread: boolean,
): K | null {
  return wasUnread ? rowId : explicitId;
}

export function shouldStartReadDwell<K>(
  explicitId: K | null,
  resolvedId: K | null,
  isTabActive: boolean,
): boolean {
  return isTabActive && explicitId !== null && explicitId === resolvedId;
}

export function prKey(repoFullName: string | null, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

export function unreadPriorityCount(
  counts: { unreadPriority: number; byWorkspace: Record<number, number> },
  workspaceId: number | undefined,
): number {
  if (workspaceId === undefined) return counts.unreadPriority;
  return counts.byWorkspace[workspaceId] ?? 0;
}

export function describeCleared(count: number, githubFailures: number): string {
  const cleared = `Cleared ${count} ${count === 1 ? 'item' : 'items'}`;
  if (githubFailures === 0) return cleared;
  return `${cleared}, ${githubFailures} could not be marked done on GitHub`;
}

export function pickReviewProject(
  projects: { slug: string; isDefault: boolean }[],
  correlatedSlug: string | null,
): string | null {
  if (correlatedSlug) return correlatedSlug;
  return (projects.find((project) => project.isDefault) ?? projects[0])?.slug ?? null;
}
