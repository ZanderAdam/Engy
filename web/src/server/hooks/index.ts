import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { persistTerminalSession } from '../ws/terminal-session-store';
import {
  handleNotificationActivity,
  handleStopActivity,
  handleUserPromptSubmitActivity,
} from './activity';
import { settleDispatchOnStop, tagDispatchDeliveryTurn } from './dispatch';
import { clearFailureOnStop, clearFailureOnUserPromptSubmit, recordStopFailure } from './failure';
import { handleMemoryCaptureIngest } from './memory-capture-ingest';
import { MEMORY_CAPTURE_HOOK_EVENT } from './memory';
import { buildSessionStartContext } from './session-context';
import { handleSubagentStart, handleSubagentStop } from './subagent';
import { handleClearAttention, handleNotificationAttention, handleStopTitle } from './title';
import type { HookHandler, HookPayload, HookRegistry, HookResult } from './types';
import { handleWorktreeCreate, handleWorktreeRemove } from './worktree';

/**
 * Every module's hook handler, in one reviewable list, grouped into a
 * registry keyed by `hook_event_name`. Registration order is dispatch order.
 *
 * `Stop`'s order is a real constraint: `settleDispatchOnStop` must run before
 * `handleStopActivity`, because the activity handler flushes the dispatch
 * inbox on `done` and an unsettled `delivered` dispatch at that point would
 * make "the worker's outstanding delivered dispatch" ambiguous for the next
 * delivery. `handleStopActivity` is therefore last on `Stop`.
 *
 * `PreCompact` and `SessionEnd` are intentionally absent — `hooks/memory.ts`
 * owns their entire lifecycle out of band (see that file's top comment).
 * `SessionStart` never appears here: it needs an async, differently-shaped
 * response and is handled as a special case in `handleHookRequest` instead
 * of going through this registry. The synthetic `MemoryCapture` follow-up
 * `hooks/memory.ts` POSTs is also a special case, dispatched even earlier —
 * see `handleHookRequest`'s comment on `MEMORY_CAPTURE_HOOK_EVENT`.
 */
// Exported so a test can assert the Stop-ordering invariant above against
// the actual registry, not a synthetic stand-in array.
export const HOOK_HANDLER_REGISTRATIONS: Array<{ event: string; handler: HookHandler }> = [
  { event: 'Stop', handler: settleDispatchOnStop },
  { event: 'Stop', handler: handleStopTitle },
  { event: 'Stop', handler: handleClearAttention },
  { event: 'Stop', handler: clearFailureOnStop },
  { event: 'Stop', handler: handleStopActivity },

  { event: 'UserPromptSubmit', handler: tagDispatchDeliveryTurn },
  { event: 'UserPromptSubmit', handler: handleClearAttention },
  { event: 'UserPromptSubmit', handler: clearFailureOnUserPromptSubmit },
  { event: 'UserPromptSubmit', handler: handleUserPromptSubmitActivity },

  { event: 'Notification', handler: handleNotificationAttention },
  { event: 'Notification', handler: handleNotificationActivity },

  { event: 'StopFailure', handler: recordStopFailure },

  { event: 'SubagentStart', handler: handleSubagentStart },
  { event: 'SubagentStop', handler: handleSubagentStop },

  { event: 'WorktreeCreate', handler: handleWorktreeCreate },
  { event: 'WorktreeRemove', handler: handleWorktreeRemove },
];

export function buildHookRegistry(
  registrations: Array<{ event: string; handler: HookHandler }>,
): HookRegistry {
  const registry: HookRegistry = {};
  for (const { event, handler } of registrations) {
    (registry[event] ??= []).push(handler);
  }
  return registry;
}

export const HOOK_HANDLERS: HookRegistry = buildHookRegistry(HOOK_HANDLER_REGISTRATIONS);

// A caller-supplied path token: an unbounded set of "seen unknown sessions"
// is a free memory-growth primitive against an endpoint that answers 200 {}
// either way, so this log-dedup map is itself capped and LRU-evicted.
export const MAX_LOGGED_UNKNOWN_SESSIONS = 500;
const loggedUnknownSessions = new Map<string, true>();

function shouldLogUnknownSession(sessionId: string): boolean {
  if (loggedUnknownSessions.has(sessionId)) {
    // Refresh recency so the most recently probed ids survive eviction.
    loggedUnknownSessions.delete(sessionId);
    loggedUnknownSessions.set(sessionId, true);
    return false;
  }
  loggedUnknownSessions.set(sessionId, true);
  if (loggedUnknownSessions.size > MAX_LOGGED_UNKNOWN_SESSIONS) {
    const oldest = loggedUnknownSessions.keys().next().value;
    if (oldest !== undefined) loggedUnknownSessions.delete(oldest);
  }
  return true;
}

export function _resetUnknownSessionLog(): void {
  loggedUnknownSessions.clear();
}

export function _unknownSessionLogSize(): number {
  return loggedUnknownSessions.size;
}

/**
 * Merge multiple handlers' partial results for one event: later non-empty
 * fields win per field. `terminalSequence` is a hard invariant, not a
 * convention — at most one handler per event may produce it, since two
 * handlers racing to write the terminal's OSC chrome has no sane "merge".
 */
export function dispatchHookEvent(
  handlers: HookHandler[],
  payload: HookPayload,
  meta: TerminalSessionMeta,
  state: AppState,
  sessionId: string,
): HookResult {
  const merged: HookResult = {};
  let terminalSequenceSet = false;

  for (const handler of handlers) {
    const result = handler(payload, meta, state, sessionId);
    if (!result) continue;

    for (const [key, value] of Object.entries(result) as Array<
      [keyof HookResult, string | undefined]
    >) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'terminalSequence') {
        if (terminalSequenceSet) {
          throw new Error(
            `[hooks] Multiple handlers returned terminalSequence for '${payload.hook_event_name}' — at most one is allowed`,
          );
        }
        terminalSequenceSet = true;
      }
      merged[key] = value;
    }
  }

  return merged;
}

const MAX_BODY_BYTES = 1_000_000;

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Manual body accumulation, same shape as the rename route in `server.ts`,
 * plus the size cap that route lacks: a hook body carries agent output
 * (`last_assistant_message`) with no upstream bound, from an endpoint that
 * listens on all interfaces. Once the cap is crossed the buffered chunks are
 * dropped rather than concatenated, so an oversized body never sits in memory.
 */
function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  onComplete: (body: string) => void,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let rejected = false;

  req.on('data', (chunk: Buffer) => {
    if (rejected) return;
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      rejected = true;
      chunks.length = 0;
      respondJson(res, 413, { error: 'Request body too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (rejected) return;
    onComplete(Buffer.concat(chunks).toString('utf8'));
  });

  req.on('error', () => {
    // Connection dropped mid-body — no response possible.
  });
}

export function isHookPath(pathname: string): boolean {
  return pathname.startsWith('/hooks/');
}

/** `/hooks/<sessionId>` — the Engy terminal session id is the bearer token. */
function parseHookSessionId(pathname: string): string | undefined {
  return decodeURIComponent(pathname.slice('/hooks/'.length)) || undefined;
}

/**
 * `POST /hooks/<sessionId>` — mirrors `/mcp/<sessionId>`'s addressing: an
 * unguessable id in the path is the only identity channel a hook POST honors.
 */
export function handleHookRequest(
  state: AppState,
  req: IncomingMessage,
  res: ServerResponse,
  registry: HookRegistry = HOOK_HANDLERS,
): void {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  let sessionId: string | undefined;
  try {
    sessionId = parseHookSessionId(url.pathname);
  } catch {
    respondJson(res, 400, { error: 'Invalid percent-encoding in hook path' });
    return;
  }
  if (!sessionId) {
    respondJson(res, 400, { error: 'sessionId is required' });
    return;
  }
  const resolvedSessionId = sessionId;

  readBody(req, res, (rawBody) => {
    let payload: HookPayload;
    try {
      payload = JSON.parse(rawBody) as HookPayload;
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (typeof payload?.hook_event_name !== 'string' || !payload.hook_event_name) {
      respondJson(res, 400, { error: 'hook_event_name is required' });
      return;
    }

    // Per-type `Notification` matcher URLs (task 3's fallback for an
    // unconfirmed `notification_type` body field) carry the type as
    // `?notification_type=`. The body field wins when both are present; an
    // absent type stays absent rather than being guessed.
    if (!payload.notification_type) {
      const queryType = url.searchParams.get('notification_type');
      if (queryType) payload.notification_type = queryType;
    }

    // MemoryCapture is a synthetic follow-up from the detached nested job in
    // hooks/memory.ts, not a live CLI hook — it arrives up to ~20s after
    // PreCompact/SessionEnd fired, by which point SessionEnd's originating
    // terminal has typically already exited and deleted its
    // terminalSessionMeta (its PTY exits almost immediately once the parent
    // hook returns). It cannot go through the meta-liveness gate below, since
    // that would silently drop every SessionEnd capture; it resolves its own
    // workspace (live meta first, falling back to session history) and
    // always acks `{}`.
    if (payload.hook_event_name === MEMORY_CAPTURE_HOOK_EVENT) {
      handleMemoryCaptureIngest(state, payload, resolvedSessionId);
      respondJson(res, 200, {});
      return;
    }

    // Sessions outlive a server's memory of them (restart, expiry). A 4xx per
    // turn would surface a visible error in the user's terminal every turn
    // for no benefit, so an unknown session is a no-op 200, not an error.
    const meta = state.terminalSessionMeta.get(resolvedSessionId);
    if (!meta) {
      if (shouldLogUnknownSession(resolvedSessionId)) {
        console.warn(
          `[hooks] Unknown session ${resolvedSessionId} for event '${payload.hook_event_name}'`,
        );
      }
      respondJson(res, 200, {});
      return;
    }

    // Persisted so the hookDriven/lastHookAt override rule survives a
    // restart instead of silently resetting to "trust the relay" every time.
    meta.hookDriven = true;
    meta.lastHookAt = Date.now();
    persistTerminalSession(resolvedSessionId, meta);

    // SessionStart is delivered as a `command` hook, not `http` — claude
    // 2.1.251 silently drops http hooks for this event and only honours the
    // nested `{hookSpecificOutput}` shape, unlike every other (flat)
    // HookResult. It cannot go through the synchronous HookHandler registry,
    // so it is handled here as a narrow, explicitly async special case.
    if (payload.hook_event_name === 'SessionStart') {
      buildSessionStartContext(payload, meta)
        .then((result) => respondJson(res, 200, result))
        .catch((err: unknown) => {
          console.error('[hooks] SessionStart context build failed:', err);
          respondJson(res, 200, {});
        });
      return;
    }

    const handlers = registry[payload.hook_event_name] ?? [];
    if (handlers.length === 0) {
      console.log(`[hooks] No handler registered for event '${payload.hook_event_name}'`);
      respondJson(res, 200, {});
      return;
    }

    let result: HookResult;
    try {
      result = dispatchHookEvent(handlers, payload, meta, state, resolvedSessionId);
    } catch (err) {
      console.error(`[hooks] Handler error for event '${payload.hook_event_name}':`, err);
      respondJson(res, 500, { error: 'Hook handler failed' });
      return;
    }
    respondJson(res, 200, result);
  });
}
