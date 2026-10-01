import { useMemo } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { prKey } from '@/components/inbox/inbox-helpers';

export function usePrInbox(workspaceId: number, enabled: boolean) {
  const utils = trpc.useUtils();
  const { data: items } = trpc.inbox.list.useQuery({ tab: 'all', workspaceId }, { enabled });

  const { mutate: markRead } = trpc.inbox.markRead.useMutation({
    onSuccess: () => {
      void utils.inbox.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const unreadItemIds = useMemo(() => {
    const ids = new Map<string, number>();
    for (const item of items ?? []) {
      if (item.unread) ids.set(prKey(item.repoFullName, item.prNumber), item.id);
    }
    return ids;
  }, [items]);

  return { unreadItemIds, markRead };
}
