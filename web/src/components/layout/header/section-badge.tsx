'use client';

import { trpc } from '@/lib/trpc';
import { formatInboxBadge } from '@/components/inbox/inbox-button';

export function SectionBadge({ workspaceId }: { workspaceId: number }) {
  const { data } = trpc.inbox.counts.useQuery();

  const label = formatInboxBadge(data?.byWorkspace[workspaceId] ?? 0);
  if (!label) return null;

  return (
    <span
      aria-label={`${label} unread`}
      className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-4 text-muted-foreground"
    >
      {label}
    </span>
  );
}
