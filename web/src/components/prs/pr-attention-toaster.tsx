'use client';

import { toast } from 'sonner';
import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';
import { getAttentionInfo } from './pr-attention';

export function PrAttentionToaster() {
  const utils = trpc.useUtils();

  useOnServerEvent('PR_ATTENTION', (payload) => {
    const info = getAttentionInfo(payload.reason);
    toast.error(`PR #${payload.prNumber}: ${info?.label ?? 'CI failure needs attention'}`, {
      description: info?.description,
    });
    void utils.pr.list.invalidate({ workspaceId: payload.workspaceId });
  });

  return null;
}
