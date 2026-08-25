import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { TerminalExitEvent, TerminalKillCmd, TerminalSpawnCmd } from '@engy/common';
import type { AppState, DispatchEntry, TerminalSessionMeta } from './trpc/context';
import {
  buildAgentCommand,
  getAgentType,
  isAgentTypeId,
  MCP_SESSION_PLACEHOLDER,
  type AgentTypeId,
  type WorkspaceAgentSettings,
} from '@/lib/agent-types';
import { broadcastTerminalActivityChange, broadcastTerminalSessionsChange } from './ws/broadcast';
import {
  persistTerminalSession,
  deletePersistedTerminalSession,
} from './ws/terminal-session-store';
import { recordSessionStart, markSessionClosed } from './ws/terminal-session-history';

// Cross-terminal dispatch: an orchestrator agent sends a prompt to a worker
// terminal by injecting it into the worker's PTY stdin (same wire path as
// browser keystrokes), and the worker reports back by calling the
// `terminal_reply` MCP tool with the correlation id appended to the message.
// Delivery is idle-gated: a busy worker's dispatches queue in a per-worker
// inbox and flush one at a time as the terminal returns to idle.

const OUTPUT_TAIL_MAX_CHARS = 8_192;
const DISPATCH_RETENTION_MS = 60 * 60_000;
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
// A message containing either paste sentinel would break out of the bracketed
// paste region and deliver the remainder as raw keystrokes. Strip both so the
// caller-supplied prompt can never escape the paste.
const PASTE_SENTINEL_RE = /\x1b\[20[01]~/g;

/**
 * Workers with a per-session MCP endpoint are identified on every tool call,
 * so the server matches their reply to the open dispatch itself — the contract
 * is just "reply via terminal_reply". Workers without one (hand-configured
 * agents at plain /mcp) must echo the correlation id back.
 */
export function replyContract(correlationId: string, hasSessionEndpoint: boolean): string {
  if (hasSessionEndpoint) {
    return (
      '[engy-dispatch] This request comes from another agent that can NOT see this ' +
      "terminal — only what you pass to the Engy MCP tool `terminal_reply` reaches it. " +
      'Put your actual answer/deliverable in the `result` field, not a note that you ' +
      'answered. Call the tool even if you fail or cannot proceed.'
    );
  }
  return (
    `[engy-dispatch ${correlationId}] This request comes from another agent that can NOT ` +
    `see this terminal — only what you pass to the Engy MCP tool \`terminal_reply\` ` +
    `(with correlationId "${correlationId}") reaches it. Put your actual ` +
    `answer/deliverable in the \`result\` field, not a note that you answered. Call the ` +
    `tool even if you fail or cannot proceed.`
  );
}

/** Write raw data into a terminal session's PTY stdin via the daemon relay. */
export function injectTerminalInput(state: AppState, sessionId: string, data: string): boolean {
  const daemon = state.terminalDaemon;
  if (!daemon || daemon.readyState !== daemon.OPEN) return false;
  daemon.send(JSON.stringify({ t: 'i', sessionId, d: data }));
  return true;
}

export function connectWorker(state: AppState, sessionId: string, description: string): void {
  state.dispatchWorkers.set(sessionId, { description, connectedAt: Date.now() });
}

export function disconnectWorker(state: AppState, sessionId: string): void {
  state.dispatchWorkers.delete(sessionId);
  state.terminalOutputTails.delete(sessionId);
  // Called on every session death path — also drop reply notices queued for
  // this session as a dispatch origin, they can never be delivered.
  state.dispatchReplyNotices.delete(sessionId);
}

interface WorkerInfo {
  sessionId: string;
  description: string;
  agentType?: string;
  scopeLabel?: string;
  workingDir?: string;
  activityState: string;
  alive: boolean;
}

export function listWorkers(state: AppState): WorkerInfo[] {
  return Array.from(state.dispatchWorkers.entries()).map(([sessionId, worker]) => {
    const meta = state.terminalSessionMeta.get(sessionId);
    return {
      sessionId,
      description: worker.description,
      agentType: meta?.agentType,
      scopeLabel: meta?.scopeLabel,
      workingDir: meta?.workingDir,
      activityState: meta?.activityState ?? 'idle',
      alive: meta != null,
    };
  });
}

// A worker can receive input when it isn't mid-turn ('active') and isn't
// blocked on an interactive prompt ('waiting' — injecting there would answer
// the pending prompt instead of starting a new turn).
function isDeliverable(state: AppState, workerSessionId: string): boolean {
  const activity = state.terminalSessionMeta.get(workerSessionId)?.activityState;
  return activity == null || activity === 'idle' || activity === 'done';
}

function pruneOldDispatches(state: AppState, now: number): void {
  for (const [id, entry] of state.dispatches) {
    const isSettled = entry.status === 'replied' || entry.status === 'failed';
    if (isSettled && now - entry.createdAt > DISPATCH_RETENTION_MS) {
      state.dispatches.delete(id);
      state.dispatchWaiters.delete(id);
    }
  }
}

export function createDispatch(
  state: AppState,
  workerSessionId: string,
  message: string,
  opts?: { originSessionId?: string; notifyOnReply?: boolean },
): DispatchEntry {
  const now = Date.now();
  pruneOldDispatches(state, now);

  const entry: DispatchEntry = {
    correlationId: randomUUID(),
    workerSessionId,
    message,
    status: 'queued',
    createdAt: now,
    originSessionId: opts?.originSessionId,
    notifyOnReply: opts?.notifyOnReply,
  };
  state.dispatches.set(entry.correlationId, entry);

  if (isDeliverable(state, workerSessionId) && !hasQueuedDispatch(state, workerSessionId)) {
    deliverDispatch(state, entry);
  } else {
    const inbox = state.dispatchInbox.get(workerSessionId) ?? [];
    inbox.push(entry.correlationId);
    state.dispatchInbox.set(workerSessionId, inbox);
  }
  return entry;
}

function hasQueuedDispatch(state: AppState, workerSessionId: string): boolean {
  return (state.dispatchInbox.get(workerSessionId)?.length ?? 0) > 0;
}

/** Paste text into a terminal and submit it per the agent CLI's paste mechanics. */
function injectPromptToTerminal(state: AppState, sessionId: string, text: string): boolean {
  const meta = state.terminalSessionMeta.get(sessionId);
  const agentTypeId: AgentTypeId | undefined =
    meta?.agentType && isAgentTypeId(meta.agentType) ? meta.agentType : undefined;
  const paste = getAgentType(agentTypeId).paste;

  const pasted = `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
  if (!injectTerminalInput(state, sessionId, pasted)) return false;

  // TUIs swallow an Enter sent in the same instant as the paste — submit after
  // a short per-CLI delay (see AgentPasteBehavior).
  const timer = setTimeout(() => {
    for (let i = 0; i < paste.enterCount; i++) {
      injectTerminalInput(state, sessionId, '\r');
    }
  }, paste.submitDelayMs);
  timer.unref?.();
  return true;
}

/** True when this terminal's CLI was launched with its own /mcp/<sessionId> endpoint. */
function hasSessionEndpoint(state: AppState, sessionId: string): boolean {
  return state.terminalSessionMeta.get(sessionId)?.command?.includes(`/mcp/${sessionId}`) ?? false;
}

function deliverDispatch(state: AppState, entry: DispatchEntry): void {
  const safeMessage = entry.message.replace(PASTE_SENTINEL_RE, '');
  const contract = replyContract(
    entry.correlationId,
    hasSessionEndpoint(state, entry.workerSessionId),
  );
  if (!injectPromptToTerminal(state, entry.workerSessionId, `${safeMessage}\n\n${contract}`)) {
    settleDispatch(state, entry, 'failed', undefined, 'No daemon connected');
    return;
  }

  entry.status = 'delivered';
  entry.deliveredAt = Date.now();
  const agentType = state.terminalSessionMeta.get(entry.workerSessionId)?.agentType ?? 'shell';
  console.log(
    `[dispatch] delivered ${entry.correlationId} to ${entry.workerSessionId.slice(0, 8)} (${agentType})`,
  );
}

/** Deliver queued reply notices and the next queued dispatch for a terminal that just went idle. */
export function flushDispatchInbox(state: AppState, workerSessionId: string): void {
  if (!isDeliverable(state, workerSessionId)) return;

  // Reply notices first — they are informational and cheap; all pending ones
  // are combined into a single paste so one idle transition drains them.
  const notices = state.dispatchReplyNotices.get(workerSessionId);
  if (notices?.length) {
    state.dispatchReplyNotices.delete(workerSessionId);
    if (!injectPromptToTerminal(state, workerSessionId, notices.join('\n\n'))) {
      // Daemon dropped mid-flush — restore so the next idle transition retries.
      state.dispatchReplyNotices.set(workerSessionId, notices);
      console.warn(`[dispatch] notice flush failed for ${workerSessionId.slice(0, 8)} — requeued`);
    }
    // The paste flips the terminal to active; the next act→idle transition
    // flushes the dispatch inbox.
    return;
  }

  const inbox = state.dispatchInbox.get(workerSessionId);
  if (!inbox || inbox.length === 0) return;

  // One at a time: the delivery flips the worker to active; the next act→idle
  // transition flushes the next entry.
  const correlationId = inbox.shift()!;
  if (inbox.length === 0) state.dispatchInbox.delete(workerSessionId);
  const entry = state.dispatches.get(correlationId);
  if (entry && entry.status === 'queued') {
    deliverDispatch(state, entry);
  }
}

const NOTICE_RESULT_MAX_CHARS = 2_000;

/**
 * Push a settled dispatch's outcome into the origin terminal (async mode and
 * timed-out sync dispatches) so the orchestrator does not have to poll
 * terminal_collect. Injected immediately when the origin is idle, otherwise
 * queued and flushed on its next idle transition.
 */
function notifyOrigin(state: AppState, entry: DispatchEntry): void {
  const origin = entry.originSessionId;
  if (!origin || !state.terminalSessionMeta.has(origin)) return;

  const worker = state.dispatchWorkers.get(entry.workerSessionId);
  const outcome =
    entry.status === 'replied'
      ? `replied: ${(entry.result ?? '').slice(0, NOTICE_RESULT_MAX_CHARS)}`
      : `failed: ${entry.error ?? 'unknown error'}`;
  // Marker deliberately distinct from the [engy-dispatch] contract so the
  // origin agent cannot mistake the notice for a new dispatched request.
  const notice =
    `[engy-notice ${entry.correlationId}] Worker "${worker?.description ?? entry.workerSessionId.slice(0, 8)}" ` +
    `${outcome}\n(Informational — your earlier terminal_dispatch settled. Do not reply or re-dispatch because of this notice.)`;
  const safeNotice = notice.replace(PASTE_SENTINEL_RE, '');

  // Direct-inject only when nothing else is queued for the origin — pending
  // notices or dispatches would otherwise be overtaken out of arrival order.
  const hasPendingNotices = (state.dispatchReplyNotices.get(origin)?.length ?? 0) > 0;
  if (isDeliverable(state, origin) && !hasQueuedDispatch(state, origin) && !hasPendingNotices) {
    if (injectPromptToTerminal(state, origin, safeNotice)) return;
  }
  const pending = state.dispatchReplyNotices.get(origin) ?? [];
  pending.push(safeNotice);
  state.dispatchReplyNotices.set(origin, pending);
}

function settleDispatch(
  state: AppState,
  entry: DispatchEntry,
  status: 'replied' | 'failed',
  result?: string,
  error?: string,
): void {
  entry.status = status;
  entry.result = result;
  entry.error = error;
  entry.repliedAt = Date.now();
  const waiters = state.dispatchWaiters.get(entry.correlationId);
  state.dispatchWaiters.delete(entry.correlationId);
  if (waiters) {
    for (const waiter of waiters) waiter(entry);
  }
  if (entry.notifyOnReply) {
    notifyOrigin(state, entry);
  }
}

// A 'delivered' entry that never receives a reply (worker ignored the contract,
// or the daemon dropped between paste and Enter) is recovered by: the sync
// dispatch timeout returning 'delivered' with a collect hint, terminal_collect
// polling, or failWorkerDispatches when the worker terminal exits. Dispatches
// are in-memory and best-effort — lost on web restart.
/** Called by the terminal_reply MCP tool. Returns false for unknown/settled ids. */
export function resolveDispatchReply(
  state: AppState,
  correlationId: string,
  result: string,
): boolean {
  const entry = state.dispatches.get(correlationId);
  if (!entry || entry.status === 'replied' || entry.status === 'failed') return false;
  settleDispatch(state, entry, 'replied', result);
  console.log(`[dispatch] reply for ${correlationId} (${result.length} chars)`);
  return true;
}

/**
 * Settle a reply from an identified worker without a correlation id: matches
 * the oldest undelivered-reply ('delivered') dispatch for that worker. Sound
 * because delivery is one-at-a-time per worker and PTY prompts are processed
 * in order, so replies arrive in delivery order. Returns the settled entry,
 * or null when the worker has no delivered dispatch awaiting a reply.
 */
export function resolveWorkerReply(
  state: AppState,
  workerSessionId: string,
  result: string,
): DispatchEntry | null {
  let oldest: DispatchEntry | null = null;
  for (const entry of state.dispatches.values()) {
    if (entry.workerSessionId !== workerSessionId || entry.status !== 'delivered') continue;
    if (!oldest || (entry.deliveredAt ?? 0) < (oldest.deliveredAt ?? 0)) oldest = entry;
  }
  if (!oldest) return null;
  settleDispatch(state, oldest, 'replied', result);
  console.log(
    `[dispatch] reply for ${oldest.correlationId} via worker identity ${workerSessionId.slice(0, 8)} (${result.length} chars)`,
  );
  return oldest;
}

/** Fail every unsettled dispatch for a worker (terminal exited / killed). */
export function failWorkerDispatches(
  state: AppState,
  workerSessionId: string,
  reason: string,
): void {
  state.dispatchInbox.delete(workerSessionId);
  for (const entry of state.dispatches.values()) {
    if (
      entry.workerSessionId === workerSessionId &&
      (entry.status === 'queued' || entry.status === 'delivered')
    ) {
      settleDispatch(state, entry, 'failed', undefined, reason);
    }
  }
}

/**
 * Wait for a dispatch to settle. Resolves with the entry's state at timeout —
 * callers distinguish by `status` ('replied'/'failed' vs still pending).
 */
export function waitForDispatchReply(
  state: AppState,
  correlationId: string,
  timeoutMs: number,
): Promise<DispatchEntry> {
  const entry = state.dispatches.get(correlationId);
  if (!entry) return Promise.reject(new Error(`Unknown correlationId: ${correlationId}`));
  if (entry.status === 'replied' || entry.status === 'failed') return Promise.resolve(entry);

  return new Promise((resolve) => {
    const waiters = state.dispatchWaiters.get(correlationId) ?? [];
    const onSettle = (settled: DispatchEntry): void => {
      clearTimeout(timer);
      resolve(settled);
    };
    waiters.push(onSettle);
    state.dispatchWaiters.set(correlationId, waiters);
    const timer = setTimeout(() => {
      const current = state.dispatchWaiters.get(correlationId);
      if (current) {
        const idx = current.indexOf(onSettle);
        if (idx >= 0) current.splice(idx, 1);
      }
      resolve(entry);
    }, timeoutMs);
    timer.unref?.();
  });
}

// ── Agent-originated spawn (terminal_spawn) ─────────────────────────

// Hard ceiling on live agent-spawned terminals. Type-agnostic, so it bounds any
// spawn chain — claude → codex → claude → … stops once 3 agent-spawned sessions
// are alive.
export const AGENT_SPAWN_LIMIT = 3;

const SPAWNED_TERMINAL_COLS = 80;
const SPAWNED_TERMINAL_ROWS = 24;

export function countAgentSpawnedSessions(state: AppState): number {
  let count = 0;
  for (const meta of state.terminalSessionMeta.values()) {
    if (meta.spawnedBy) count++;
  }
  return count;
}

interface SpawnAgentTerminalOptions {
  agentType: AgentTypeId;
  workingDir: string;
  description: string;
  prompt?: string;
  /** Caller terminal session id — recorded as the spawn origin. */
  spawnedBy: string;
  /** Caller meta — the spawned session inherits its UI scope/grouping. */
  callerMeta: TerminalSessionMeta;
  /** Server origin for the spawned agent's per-session MCP endpoint. */
  mcpOrigin: string;
  /** Workspace per-agent overrides — the spawn command applies the agent's configured mode. */
  agentSettings?: WorkspaceAgentSettings | null;
}

/**
 * Server-originated terminal spawn (no browser attached): sends the spawn to
 * the daemon relay, registers session meta, auto-connects the session as a
 * dispatch worker, and broadcasts so the terminal rail picks it up. Returns
 * null when no daemon is connected.
 */
export function spawnAgentTerminal(
  state: AppState,
  opts: SpawnAgentTerminalOptions,
): { sessionId: string } | null {
  const daemon = state.terminalDaemon;
  if (!daemon || daemon.readyState !== daemon.OPEN) return null;

  // The sessionId is known up front, so the MCP URL is built resolved — but
  // buildCommand still emits the session-id placeholder (browser-initiated
  // spawns substitute it in the terminal server), so swap it here too.
  const sessionId = randomUUID();
  const command = buildAgentCommand(opts.agentType, {
    prompt: opts.prompt,
    mcpUrl: `${opts.mcpOrigin}/mcp/${sessionId}`,
    agentSettings: opts.agentSettings,
  }).replaceAll(MCP_SESSION_PLACEHOLDER, sessionId);

  const { callerMeta } = opts;
  daemon.send(
    JSON.stringify({
      t: 'spawn',
      sessionId,
      workingDir: opts.workingDir,
      command,
      cols: SPAWNED_TERMINAL_COLS,
      rows: SPAWNED_TERMINAL_ROWS,
      scopeType: callerMeta.scopeType,
      scopeLabel: opts.description,
    } satisfies TerminalSpawnCmd),
  );

  const meta: TerminalSessionMeta = {
    scopeType: callerMeta.scopeType,
    scopeLabel: opts.description,
    workingDir: opts.workingDir,
    command,
    agentType: opts.agentType,
    groupKey: callerMeta.groupKey,
    workspaceSlug: callerMeta.workspaceSlug,
    projectId: callerMeta.projectId,
    projectSlug: callerMeta.projectSlug,
    spawnedBy: opts.spawnedBy,
    // Start as 'active' (booting): the caller can dispatch immediately — the
    // message queues in the inbox and flushes on the CLI's first idle/done
    // settle, instead of being pasted into a half-booted TUI and lost.
    activityState: 'active',
    cols: SPAWNED_TERMINAL_COLS,
    rows: SPAWNED_TERMINAL_ROWS,
  };
  state.terminalSessionMeta.set(sessionId, meta);
  state.daemonTerminalSessions.ids.add(sessionId);
  persistTerminalSession(sessionId, meta);
  recordSessionStart(sessionId, meta);
  connectWorker(state, sessionId, opts.description);
  broadcastTerminalSessionsChange('created', sessionId, callerMeta.groupKey);
  console.log(
    `[dispatch] agent-spawned ${opts.agentType} terminal ${sessionId.slice(0, 8)} by ${opts.spawnedBy.slice(0, 8)}`,
  );
  return { sessionId };
}

/**
 * Tear down a terminal session's server-side state: session meta, attached
 * browser sockets (sent an exit frame first so their ReconnectingSocket marks
 * the session final instead of respawning a ghost), worker registration,
 * unsettled dispatches, and the destroyed/activity broadcasts. Does NOT signal
 * the daemon — callers own that (kill forward vs. server-sent kill).
 */
export function destroyTerminalSession(
  state: AppState,
  sessionId: string,
  opts?: { excludeWs?: WebSocket },
): TerminalSessionMeta | undefined {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (meta?.agentType) {
    markSessionClosed(meta.resumedFrom ?? sessionId);
  }
  state.terminalSessionMeta.delete(sessionId);
  state.daemonTerminalSessions.ids.delete(sessionId);
  deletePersistedTerminalSession(sessionId);

  const wsSet = state.terminalSessions.get(sessionId);
  if (wsSet) {
    const exitFrame = JSON.stringify({
      t: 'exit',
      sessionId,
      exitCode: 0,
    } satisfies TerminalExitEvent);
    for (const bws of wsSet) {
      if (bws !== opts?.excludeWs && bws.readyState === bws.OPEN) {
        bws.send(exitFrame);
        bws.close(1001, 'Session killed');
      }
    }
  }
  state.terminalSessions.delete(sessionId);

  failWorkerDispatches(state, sessionId, 'Worker terminal killed');
  disconnectWorker(state, sessionId);
  // 'killed' tells the UI to remove the tab — every destroyTerminalSession
  // caller is a deliberate teardown, unlike a natural PTY exit whose tab
  // stays visible with its final output.
  broadcastTerminalSessionsChange('destroyed', sessionId, meta?.groupKey, undefined, 'killed');
  if (meta?.projectSlug) {
    broadcastTerminalActivityChange({ sessionId, projectSlug: meta.projectSlug, removed: true });
  }
  return meta;
}

/**
 * Server-originated close of an agent-spawned terminal (terminal_close):
 * signals the daemon to kill the PTY (SIGTERM, SIGKILL after 3s) and tears
 * down the server-side session state. Returns false when no daemon is
 * connected — the PTY would survive unkilled, so the close is refused.
 * (Deliberately stricter than a browser kill, which tears down server state
 * daemon or not: the agent gets a clear retry signal instead of a silently
 * orphaned PTY, and the sync handler reconciles state once a daemon returns.)
 */
export function closeAgentTerminal(state: AppState, sessionId: string): boolean {
  const daemon = state.terminalDaemon;
  if (!daemon || daemon.readyState !== daemon.OPEN) return false;
  daemon.send(JSON.stringify({ t: 'kill', sessionId } satisfies TerminalKillCmd));
  destroyTerminalSession(state, sessionId);
  console.log(`[dispatch] agent-closed terminal ${sessionId.slice(0, 8)}`);
  return true;
}

/** True when the relay should buffer this session's output for terminal_status. */
export function isTrackedWorker(state: AppState, sessionId: string): boolean {
  return state.dispatchWorkers.has(sessionId);
}

/** Append a PTY output chunk to the worker's bounded tail buffer. */
export function recordWorkerOutput(state: AppState, sessionId: string, chunk: string): void {
  const existing = state.terminalOutputTails.get(sessionId) ?? '';
  const combined = existing + chunk;
  state.terminalOutputTails.set(
    sessionId,
    combined.length > OUTPUT_TAIL_MAX_CHARS ? combined.slice(-OUTPUT_TAIL_MAX_CHARS) : combined,
  );
}

/** Recent output tail with ANSI escapes stripped (for terminal_status). */
export function getWorkerOutputTail(state: AppState, sessionId: string): string {
  const raw = state.terminalOutputTails.get(sessionId) ?? '';
  // Strip OSC sequences, CSI/escape codes, and normalize CR-redraws to newlines.
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r+\n/g, '\n')
    .replace(/\r/g, '\n');
}
