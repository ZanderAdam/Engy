import type { TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import { isSubagentEvent } from './shared';
import type { HookHandler, HookPayload } from './types';

// TG1's probe never captured a live StopFailure payload (it needs a real API
// failure to provoke), so the field carrying the error type is unconfirmed.
// Checked in order of how the CLI names matcher-carrying fields on other
// events already captured (`notification_type`, SessionEnd's `reason`):
// `error_type`, `failure_type`, a string `error` field, `error.type` for an
// object-shaped `error`, then `reason`. Falls back to 'unknown' — one of the
// plan's own documented matcher values — rather than guessing.
function readFailureType(payload: HookPayload): string {
  const direct = payload.error_type ?? payload.failure_type;
  if (typeof direct === 'string' && direct) return direct;

  const error = payload.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && 'type' in error) {
    const type = (error as Record<string, unknown>).type;
    if (typeof type === 'string' && type) return type;
  }

  const reason = payload.reason;
  if (typeof reason === 'string' && reason) return reason;

  return 'unknown';
}

function readFailureMessage(payload: HookPayload): string {
  const message = payload.message;
  if (typeof message === 'string' && message) return message;

  const error = payload.error;
  if (error && typeof error === 'object' && 'message' in error) {
    const nested = (error as Record<string, unknown>).message;
    if (typeof nested === 'string' && nested) return nested;
  }

  return '';
}

/**
 * Records a `StopFailure`'s error type on the session so `isDeliverable()`
 * (terminal-dispatch.ts) can hold it out of dispatch delivery instead of a
 * rate-limited/errored worker reading as idle and receiving the next
 * dispatch, which fails identically.
 */
export const recordStopFailure: HookHandler = (payload, meta, _state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  meta.lastFailure = {
    type: readFailureType(payload),
    message: readFailureMessage(payload),
    at: Date.now(),
  };
  persistTerminalSession(sessionId, meta);
};

function clearFailure(payload: HookPayload, meta: TerminalSessionMeta, sessionId: string): void {
  if (isSubagentEvent(payload)) return;
  if (!meta.lastFailure) return;

  meta.lastFailure = undefined;
  persistTerminalSession(sessionId, meta);
}

/** Restores deliverability on the session's next turn after a StopFailure. */
export const clearFailureOnUserPromptSubmit: HookHandler = (payload, meta, _state, sessionId) => {
  clearFailure(payload, meta, sessionId);
};

/** Restores deliverability on the session's next Stop after a StopFailure. */
export const clearFailureOnStop: HookHandler = (payload, meta, _state, sessionId) => {
  clearFailure(payload, meta, sessionId);
};
