import { WebSocket } from 'ws';
import type { TerminalTitleMsg } from '@engy/common';
import { sanitizeOscTitle } from '@/lib/osc-title';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import { updateSessionSummary } from '../ws/terminal-session-history';
import { ATTENTION_NOTIFICATION_TYPES, isSubagentEvent, resolveNotificationType } from './shared';
import type { HookHandler } from './types';

function deriveTitle(message: string): string {
  const firstLine = message.split('\n').find((line) => line.trim().length > 0) ?? '';
  return sanitizeOscTitle(firstLine);
}

// Mirrors the reconnect-replay push in terminal-server.ts: a title set with
// no browser attached still needs to reach one that's already open.
function pushTitleToAttachedBrowsers(state: AppState, sessionId: string, title: string): void {
  const wsSet = state.terminalSessions.get(sessionId);
  if (!wsSet) return;
  const msg = JSON.stringify({ t: 'title', sessionId, title } satisfies TerminalTitleMsg);
  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

/**
 * Derives the session's title from the turn's final assistant reply, so
 * agent-spawned terminals with no browser attached still get one. Subagent
 * `Stop` events reuse the parent session's `session_id`, distinguished only
 * by `agent_id` — without the guard below a subagent's internal reply would
 * overwrite the parent session's title.
 */
export const handleStopTitle: HookHandler = (payload, meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  const message = payload.last_assistant_message;
  if (typeof message !== 'string' || !message) return;

  const title = deriveTitle(message);
  if (!title || title === meta.lastTitle) return;

  meta.lastTitle = title;
  persistTerminalSession(sessionId, meta);
  updateSessionSummary(meta.resumedFrom ?? sessionId, title);
  pushTitleToAttachedBrowsers(state, sessionId, title);
};

// No direct browser push: `needsAttention` rides the TERMINAL_ACTIVITY_CHANGE
// broadcast, which every event that can change it already triggers through
// activity.ts's applyActivityState.
function setAttention(sessionId: string, meta: TerminalSessionMeta, value: boolean): void {
  if (Boolean(meta.needsAttention) === value) return;
  meta.needsAttention = value;
  persistTerminalSession(sessionId, meta);
}

/**
 * Clears `needsAttention` for a session directly by id — the entry point for
 * the browser focus `{t:'ack'}` path, which resolves a session id rather than
 * a `meta` reference. Wired centrally into `terminal-server.ts`'s ack handler.
 */
export function clearAttention(state: AppState, sessionId: string): void {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (!meta) return;
  setAttention(sessionId, meta, false);
}

/**
 * Marks the session as needing attention on a `Notification` matching one of
 * the three prompt/input types. Subagent notifications reuse the parent's
 * `session_id` (see `handleStopTitle`'s comment) and are ignored here too.
 */
export const handleNotificationAttention: HookHandler = (payload, meta, _state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  const type = resolveNotificationType(payload);
  if (!type || !ATTENTION_NOTIFICATION_TYPES.has(type)) return;

  setAttention(sessionId, meta, true);
};

/**
 * Clears `needsAttention` at a turn boundary. Registered for both `Stop` and
 * `UserPromptSubmit` — answering a permission prompt resumes the same turn,
 * so `Stop` alone would leave the mark lit across dispatches that end in a
 * fresh prompt, and `UserPromptSubmit` alone would leave it lit through a
 * turn no one blocked on. Subagent events are ignored, matching every other
 * session-level handler in this file.
 */
export const handleClearAttention: HookHandler = (payload, meta, _state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  setAttention(sessionId, meta, false);
};
