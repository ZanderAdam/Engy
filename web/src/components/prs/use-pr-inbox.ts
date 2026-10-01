import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export function prInboxKey(repoFullName: string | null, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

export function usePrInbox(workspaceId: number, enabled: boolean) {
  const utils = trpc.useUtils();
  const { data: items } = trpc.inbox.list.useQuery({ tab: 'all', workspaceId }, { enabled });

  const { mutate: markRead } = trpc.inbox.markRead.useMutation({
    onSuccess: () => {
      void utils.inbox.list.invalidate();
      void utils.inbox.counts.invalidate();
    },
  });

  const unreadItemIds = useMemo(() => {
    const ids = new Map<string, number>();
    for (const item of items ?? []) {
      if (item.unread) ids.set(prInboxKey(item.repoFullName, item.prNumber), item.id);
    }
    return ids;
  }, [items]);

  return { unreadItemIds, markRead };
}
