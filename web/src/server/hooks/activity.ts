import type { TerminalActivityState } from '@engy/common';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import { broadcastTerminalActivityChange } from '../ws/broadcast';
import { flushDispatchInbox } from '../terminal-dispatch';
import { ATTENTION_NOTIFICATION_TYPES, isSubagentEvent, resolveNotificationType } from './shared';
import type { HookHandler } from './types';

// 'user' is a direct action (focusing the terminal), so it outranks the hook
// trust window that 'relay' inference is held to.
type ActivitySource = 'relay' | 'hook' | 'user';

/**
 * Bounds how long a hook-derived activity state resists a stale `{t:'act'}`
 * relay message. No measured `Stop` lag exists — TG1's probe needed a human
 * and wasn't run — so this is sized off the only concrete number available:
 * the daemon's own debounce (`ACTIVITY_DEBOUNCE_MS`, 3s,
 * `client/src/terminal/manager.ts`), which bounds how stale a trailing act
 * message can be. Doubled for headroom against hook POST/GC latency on top
 * of that worst case. A dropped `Stop` therefore self-heals via the relay
 * within one extra debounce cycle instead of pinning the session forever.
 */
export const ACTIVITY_HOOK_TRUST_WINDOW_MS = 6_000;

function isWithinHookTrustWindow(meta: TerminalSessionMeta): boolean {
  if (!meta.hookDriven || meta.lastHookAt == null) return false;
  return Date.now() - meta.lastHookAt < ACTIVITY_HOOK_TRUST_WINDOW_MS;
}

/**
 * Shared by the relay's `{t:'act'}` handler and every hook that observes
 * activity. A hook-sourced call always applies; a relay-sourced call is
 * dropped while a hook-driven session is inside the trust window, so
 * trailing PTY output cannot overwrite a fresher hook-derived state.
 */
export function applyActivityState(
  state: AppState,
  sessionId: string,
  next: TerminalActivityState,
  source: ActivitySource,
): void {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (!meta) return;
  if (source === 'relay' && isWithinHookTrustWindow(meta)) return;

  meta.activityState = next;
  persistTerminalSession(sessionId, meta);
  broadcastTerminalActivityChange({
    sessionId,
    projectSlug: meta.projectSlug,
    state: next,
    hookDriven: meta.hookDriven,
  });
  // Idle-gated dispatch delivery: a worker that just finished its turn
  // receives the next queued cross-terminal dispatch.
  if (next === 'idle' || next === 'done') {
    flushDispatchInbox(state, sessionId);
  }
}

export const handleUserPromptSubmitActivity: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  applyActivityState(state, sessionId, 'active', 'hook');
};

export const handleStopActivity: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  applyActivityState(state, sessionId, 'done', 'hook');
};

const IDLE_NOTIFICATION_TYPES = new Set(['idle_prompt']);

export const handleNotificationActivity: HookHandler = (payload, _meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;
  const type = resolveNotificationType(payload);
  if (!type) return;

  let next: TerminalActivityState | undefined;
  if (ATTENTION_NOTIFICATION_TYPES.has(type)) next = 'waiting';
  else if (IDLE_NOTIFICATION_TYPES.has(type)) next = 'idle';
  if (!next) return;

  applyActivityState(state, sessionId, next, 'hook');
};
