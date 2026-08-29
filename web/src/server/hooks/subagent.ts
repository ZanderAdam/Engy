import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import type { HookHandler, HookPayload } from './types';

function readAgentId(payload: HookPayload): string | undefined {
  return typeof payload.agent_id === 'string' && payload.agent_id ? payload.agent_id : undefined;
}

// Keyed by the meta object itself (a WeakMap, not the session id) so the
// tracked ids are garbage-collected along with the session — no separate
// cleanup path needed when a session ends. A Set of live agent_ids (rather
// than a bare incremented/decremented counter) makes a duplicate or
// unmatched SubagentStop naturally idempotent — deleting an id that was
// never added, or already removed, is a no-op, so the exposed count can
// never drop below zero without a floor check.
const activeSubagentIds = new WeakMap<TerminalSessionMeta, Set<string>>();

function applyAndPersist(state: AppState, sessionId: string, meta: TerminalSessionMeta): void {
  meta.activeSubagents = activeSubagentIds.get(meta)?.size ?? 0;
  persistTerminalSession(sessionId, meta);
}

// SubagentStart/SubagentStop are ABOUT the subagent and reuse the parent
// session's own session_id, distinguished only by `agent_id` — unlike every
// other handler in this hook channel (activity.ts, title.ts, dispatch.ts,
// failure.ts), this is the one place `agent_id` must NOT cause an early return.
export const handleSubagentStart: HookHandler = (payload, meta, state, sessionId) => {
  const agentId = readAgentId(payload);
  if (!agentId) return;

  let ids = activeSubagentIds.get(meta);
  if (!ids) {
    ids = new Set();
    activeSubagentIds.set(meta, ids);
  }
  ids.add(agentId);
  applyAndPersist(state, sessionId, meta);
};

export const handleSubagentStop: HookHandler = (payload, meta, state, sessionId) => {
  const agentId = readAgentId(payload);
  if (!agentId) return;

  activeSubagentIds.get(meta)?.delete(agentId);
  applyAndPersist(state, sessionId, meta);
};
