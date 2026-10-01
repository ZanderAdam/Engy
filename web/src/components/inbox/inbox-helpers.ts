import type { RouterOutputs } from '@/lib/trpc';

export type InboxItem = RouterOutputs['inbox']['list'][number];

export function itemProjectSlug(item: InboxItem): string | undefined {
  return (item as { projectSlug?: string | null }).projectSlug ?? undefined;
}

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
