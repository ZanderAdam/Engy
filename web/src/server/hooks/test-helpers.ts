import type WebSocket from 'ws';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import type { HookPayload } from './types';

export function fakeDaemon(): { sent: string[]; ws: WebSocket } {
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => sent.push(data),
  } as unknown as WebSocket;
  return { sent, ws };
}

export function addSession(
  state: AppState,
  sessionId: string,
  agentType = 'claude',
): TerminalSessionMeta {
  const meta: TerminalSessionMeta = {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    activityState: 'idle',
    agentType,
    cols: 80,
    rows: 24,
  };
  state.terminalSessionMeta.set(sessionId, meta);
  return meta;
}

// `session_id` is Claude's own conversation id, deliberately unlike the Engy
// terminal session id the hook path carries.
export function hookPayload(event: string, overrides: Partial<HookPayload> = {}): HookPayload {
  return { hook_event_name: event, session_id: 'claude-conv-id', ...overrides };
}
