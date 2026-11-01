'use client';

import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import type { TerminalTab } from './types';

/** Only Claude terminals can resume; an agent-spawned one belongs to its caller. */
export function canParkTerminal(tab: TerminalTab): boolean {
  return tab.scope.agentType === 'claude' && tab.status === 'active' && !tab.spawnedBy;
}

export function useParkSession(): (sessionId: string) => void {
  const park = trpc.terminal.parkSession.useMutation({
    onError: (err) => toast.error(err.message),
  });
  return (sessionId) => park.mutate({ sessionId });
}
