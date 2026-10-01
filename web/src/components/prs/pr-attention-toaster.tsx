'use client';

import { toast } from 'sonner';
import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';
import { buildAttentionToast } from './pr-helpers';

export function PrAttentionToaster() {
  const utils = trpc.useUtils();

  useOnServerEvent('PR_ATTENTION', (payload) => {
    const { title, description } = buildAttentionToast(payload.prNumber, payload.reason);
    toast.error(title, { description });
    void utils.pr.list.invalidate({ workspaceId: payload.workspaceId });
  });

  return null;
}
