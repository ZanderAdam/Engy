import { randomUUID } from 'node:crypto';
import type { TerminalSpawnCmd } from '@engy/common';
import type { AppState, DispatchEntry, TerminalSessionMeta } from './trpc/context';
import { buildAgentCommand, getAgentType, isAgentTypeId, type AgentTypeId } from '@/lib/agent-types';
import { broadcastTerminalSessionsChange } from './ws/broadcast';

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

export function replyContract(correlationId: string): string {
  return (
    `[engy-dispatch ${correlationId}] When this request is done, report the outcome by ` +
    `calling the Engy MCP tool \`terminal_reply\` with correlationId "${correlationId}" ` +
    `and a concise result. Reply even if you fail or cannot proceed.`
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
): DispatchEntry {
  const now = Date.now();
  pruneOldDispatches(state, now);

  const entry: DispatchEntry = {
    correlationId: randomUUID(),
    workerSessionId,
    message,
    status: 'queued',
    createdAt: now,
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

function deliverDispatch(state: AppState, entry: DispatchEntry): void {
  const meta = state.terminalSessionMeta.get(entry.workerSessionId);
  const agentTypeId: AgentTypeId | undefined =
    meta?.agentType && isAgentTypeId(meta.agentType) ? meta.agentType : undefined;
  const paste = getAgentType(agentTypeId).paste;

  const safeMessage = entry.message.replace(PASTE_SENTINEL_RE, '');
  const text = `${safeMessage}\n\n${replyContract(entry.correlationId)}`;
  const pasted = `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
  if (!injectTerminalInput(state, entry.workerSessionId, pasted)) {
    settleDispatch(state, entry, 'failed', undefined, 'No daemon connected');
    return;
  }

  entry.status = 'delivered';
  entry.deliveredAt = Date.now();
  console.log(
    `[dispatch] delivered ${entry.correlationId} to ${entry.workerSessionId.slice(0, 8)} (${agentTypeId ?? 'shell'})`,
  );

  // TUIs swallow an Enter sent in the same instant as the paste — submit after
  // a short per-CLI delay (see AgentPasteBehavior).
  const timer = setTimeout(() => {
    for (let i = 0; i < paste.enterCount; i++) {
      injectTerminalInput(state, entry.workerSessionId, '\r');
    }
  }, paste.submitDelayMs);
  timer.unref?.();
}

/** Deliver the next queued dispatch for a worker that just went idle. */
export function flushDispatchInbox(state: AppState, workerSessionId: string): void {
  if (!isDeliverable(state, workerSessionId)) return;
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

// Hard ceiling on live agent-spawned terminals. Cross-type-only spawning
// (enforced by the tool) plus this cap bound any spawn chain: claude → codex →
// claude → … stops once 3 agent-spawned sessions are alive.
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

  // The sessionId is known up front, so the MCP URL is built resolved — no
  // placeholder substitution needed (unlike browser-initiated spawns).
  const sessionId = randomUUID();
  const command = buildAgentCommand(opts.agentType, {
    prompt: opts.prompt,
    mcpUrl: `${opts.mcpOrigin}/mcp/${sessionId}`,
  });

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

  state.terminalSessionMeta.set(sessionId, {
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
    cols: SPAWNED_TERMINAL_COLS,
    rows: SPAWNED_TERMINAL_ROWS,
  });
  connectWorker(state, sessionId, opts.description);
  broadcastTerminalSessionsChange('created', sessionId, callerMeta.groupKey);
  console.log(
    `[dispatch] agent-spawned ${opts.agentType} terminal ${sessionId.slice(0, 8)} by ${opts.spawnedBy.slice(0, 8)}`,
  );
  return { sessionId };
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
