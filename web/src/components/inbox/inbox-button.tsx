'use client';

import { RiInbox2Line } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { useOpenInbox } from './use-go-to-inbox';

const MAX_BADGE_COUNT = 99;

export function formatInboxBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
}

export function InboxButton() {
  const openInbox = useOpenInbox();
  const { data } = trpc.inbox.counts.useQuery();

  const badge = formatInboxBadge(data?.unreadPriority ?? 0);

  return (
    <button
      type="button"
      onClick={openInbox}
      aria-label={badge ? `Inbox, ${badge} unread (G then I)` : 'Inbox (G then I)'}
      className="relative flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
    >
      <RiInbox2Line className="size-4 text-muted-foreground" />
      {badge && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
