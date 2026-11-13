'use client';

import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';

export function useAgentTerminals() {
  const utils = trpc.useUtils();
  const { data } = trpc.terminal.listWorkers.useQuery();
  const refresh = () => void utils.terminal.listWorkers.invalidate();
  useOnServerEvent('TERMINAL_WORKERS_CHANGE', refresh);
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', refresh);
  return { agents: data ?? [], refresh };
}
