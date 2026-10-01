'use client';

import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';

export function InboxLiveSync() {
  const utils = trpc.useUtils();

  useOnServerEvent('INBOX_CHANGE', () => {
    void utils.inbox.invalidate();
  });

  return null;
}
