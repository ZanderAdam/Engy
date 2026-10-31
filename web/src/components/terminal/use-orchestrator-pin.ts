'use client';

import { trpc } from '@/lib/trpc';
import { useOnEventsConnect, useOnServerEvent } from '@/contexts/events-context';

export function useOrchestratorPin() {
  const { data } = trpc.terminal.orchestratorPin.useQuery();
  return data ?? null;
}

export function useOrchestratorPinSync(): void {
  const utils = trpc.useUtils();
  const refresh = () => void utils.terminal.orchestratorPin.invalidate();
  useOnServerEvent('TERMINAL_WORKERS_CHANGE', refresh);
  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', refresh);
  useOnServerEvent('TERMINAL_ACTIVITY_CHANGE', refresh);
  useOnEventsConnect(refresh);
}
