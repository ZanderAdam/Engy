import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';

/**
 * Keep the "Resume Session" dropdown fresh: every terminal-sessions change
 * (created/destroyed/killed) can add a history row or return one to the live
 * set, so the closed-session list is refetched on each broadcast.
 */
export function useSessionHistoryAutoInvalidation(): void {
  const utils = trpc.useUtils();

  useOnServerEvent('TERMINAL_SESSIONS_CHANGE', () => {
    utils.terminal.listSessionHistory.invalidate();
  });
}
