import type { AppState } from './trpc/context';
import { listTerminalSessions } from './ws/terminal-session-list';

export function getOrchestratorPin(state: AppState) {
  const sessions = listTerminalSessions(state, {
    all: true,
    groupKey: null,
    scopeType: '',
    scopeLabel: '',
  });
  const session = sessions.find((s) => state.terminalSessionMeta.get(s.sessionId)?.orchestrator);
  if (!session) return null;
  const waitingCount = sessions.filter(
    (s) => !s.dormant && (s.needsAttention || s.activityState === 'waiting'),
  ).length;
  return { session, waitingCount };
}
