import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { TerminalExitEvent, TerminalKillCmd, TerminalSpawnCmd } from '@engy/common';
import type { AppState, DispatchEntry, TerminalSessionMeta } from './trpc/context';
import type { StoredEvidence } from './db/schema';
import {
  buildAgentCommand,
  getAgentType,
  isAgentTypeId,
  MCP_SESSION_PLACEHOLDER,
  type AgentTypeId,
  type WorkspaceAgentSettings,
} from '@/lib/agent-types';
import {
  broadcastTerminalActivityChange,
  broadcastTerminalSessionsChange,
  broadcastTerminalWorkersChange,
} from './ws/broadcast';
import {
  persistTerminalSession,
  deletePersistedTerminalSession,
} from './ws/terminal-session-store';
import { recordSessionStart, markSessionClosed } from './ws/terminal-session-history';
import { clearLiveTargetsForSession } from './live-comment-targets';
import { AUTO_REVIEW_SPAWNER } from './review/auto-review-spawner';
import {
  SETTLED_STATUSES,
  deleteNotices,
  deleteNoticesFor,
  getDispatch,
  hasNotices,
  hasQueuedDispatch,
  insertDispatch,
  listNotices,
  listWorkerDispatches,
  pruneSettledDispatches,
  pushNotice,
  saveDispatch,
} from './terminal-dispatch-store';

// Cross-terminal dispatch: an orchestrator agent sends a prompt to a worker
// terminal by injecting it into the worker's PTY stdin (same wire path as
// browser keystrokes), and the worker reports back by calling the
// `terminal_reply` MCP tool with the correlation id appended to the message.
// Delivery is idle-gated: a busy worker's dispatches queue in SQLite and flush
// one at a time as the terminal returns to idle.

const OUTPUT_TAIL_MAX_CHARS = 65_536;
const DISPATCH_RETENTION_MS = 60 * 60_000;
const HUMAN_TYPING_HOLD_MS = 5_000;
const WRITTEN_HOLD_MS = 60_000;
const PASTE_HOLD_MS = 2_000;
const LATE_REPLY_WINDOW_MS = 10 * 60_000;
const OPT_OUT_REASON =
  'The user turned dispatch off for that terminal — it accepts no dispatched prompts.';
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
// A message containing either paste sentinel would break out of the bracketed
// paste region and deliver the remainder as raw keystrokes. Strip both so the
// caller-supplied prompt can never escape the paste.
const PASTE_SENTINEL_RE = /\x1b\[20[01]~/g;

/**
 * Both contracts carry `[engy-dispatch <id>]` so the UserPromptSubmit hook can
 * tie a turn to its dispatch. Workers with a per-session MCP endpoint are
 * identified on every tool call, so the server matches their reply itself;
 * workers without one (hand-configured agents at plain /mcp) must echo the id.
 */
export function replyContract(correlationId: string, hasSessionEndpoint: boolean): string {
  if (hasSessionEndpoint) {
    return (
      `[engy-dispatch ${correlationId}] This request comes from another agent that can NOT see this ` +
      'terminal — only what you pass to the Engy MCP tool `terminal_reply` reaches it. ' +
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
}

export function dropSessionDispatchState(state: AppState, sessionId: string): void {
  disconnectWorker(state, sessionId);
  state.terminalOutputTails.delete(sessionId);
  state.spawnAttempts.delete(sessionId);
  clearTimeout(state.deliveryRetries.get(sessionId)?.timer);
  state.deliveryRetries.delete(sessionId);
  deleteNoticesFor(sessionId);
}

interface WorkerInfo {
  sessionId: string;
  description: string;
  agentType: string;
  scopeLabel: string;
  workingDir: string;
  activityState: string;
  connected: boolean;
  orchestrator: boolean;
  dispatchOptOut: boolean;
  workspaceSlug?: string;
  projectSlug?: string;
  worktreeBranch?: string;
  taskId?: number;
}

export function listWorkers(state: AppState): WorkerInfo[] {
  const workers: WorkerInfo[] = [];
  for (const [sessionId, meta] of state.terminalSessionMeta) {
    if (!meta.agentType || meta.dormant) continue;
    const connection = state.dispatchWorkers.get(sessionId);
    workers.push({
      sessionId,
      description: connection?.description ?? meta.renamedLabel ?? meta.scopeLabel,
      agentType: meta.agentType,
      scopeLabel: meta.scopeLabel,
      workingDir: meta.workingDir,
      activityState: meta.activityState ?? 'idle',
      connected: connection !== undefined,
      orchestrator: meta.orchestrator === true,
      dispatchOptOut: meta.dispatchOptOut === true,
      workspaceSlug: meta.workspaceSlug,
      projectSlug: meta.projectSlug,
      worktreeBranch: meta.worktreeBranch,
      taskId: meta.taskId,
    });
  }
  return workers;
}

export function isOrchestrator(state: AppState, sessionId: string | undefined): boolean {
  return sessionId != null && state.terminalSessionMeta.get(sessionId)?.orchestrator === true;
}

export function dispatchRefusal(
  state: AppState,
  callerSessionId: string | undefined,
  workerSessionId: string,
): string | null {
  const workerMeta = state.terminalSessionMeta.get(workerSessionId);
  if (!workerMeta || workerMeta.dormant) return 'Worker terminal is no longer alive.';
  if (!workerMeta.agentType) {
    return 'That terminal is a plain shell — only agent terminals accept dispatches.';
  }
  if (workerMeta.dispatchOptOut) {
    return OPT_OUT_REASON;
  }
  if (callerSessionId === workerSessionId) return 'A terminal cannot dispatch to itself.';
  if (state.dispatchWorkers.has(workerSessionId)) return null;

  if (isOrchestrator(state, callerSessionId)) return null;
  return 'That terminal is not connected as a worker. Call terminal_list_workers for connected workers; the user connects one from the terminal panel, or marks one terminal as the orchestrator.';
}

// Bounds a StopFailure hold. FR-TERMINAL-840 clears it on the session's next
// UserPromptSubmit or Stop (hooks/failure.ts) — that is the normal, immediate
// path. This is the fallback for a session that never sends either again (the
// worker died mid-failure): without it, a StopFailure would strand its inbox
// forever, the same silent-forever-queue failure mode the activity trust
// window (ACTIVITY_HOOK_TRUST_WINDOW_MS) exists to avoid on the relay side.
const STOP_FAILURE_HOLD_MS = 5 * 60_000;

function remainingMs(since: number | undefined, holdMs: number): number {
  return since == null ? 0 : Math.max(0, holdMs - (Date.now() - since));
}

function metaHoldRemainingMs(state: AppState, sessionId: string): number {
  const meta = state.terminalSessionMeta.get(sessionId);
  return Math.max(
    remainingMs(meta?.lastHumanInputAt, HUMAN_TYPING_HOLD_MS),
    remainingMs(meta?.lastPasteAt, PASTE_HOLD_MS),
    remainingMs(meta?.lastFailure?.at, STOP_FAILURE_HOLD_MS),
  );
}

function writtenHoldRemainingMs(sessionId: string): number {
  const now = Date.now();
  let remaining = 0;
  for (const entry of listWorkerDispatches(sessionId, ['written'])) {
    remaining = Math.max(remaining, WRITTEN_HOLD_MS - (now - (entry.writtenAt ?? now)));
  }
  return remaining;
}

export function scheduleHoldRetry(state: AppState, sessionId: string): void {
  const delayMs = Math.max(metaHoldRemainingMs(state, sessionId), writtenHoldRemainingMs(sessionId));
  if (delayMs <= 0) return;
  const fireAt = Date.now() + delayMs + 1;
  const pending = state.deliveryRetries.get(sessionId);
  if (pending && pending.fireAt <= fireAt) return;
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    state.deliveryRetries.delete(sessionId);
    (state.deliveryRetryFlush ?? flushDispatchInbox)(state, sessionId);
  }, delayMs + 1);
  timer.unref?.();
  state.deliveryRetries.set(sessionId, { timer, fireAt });
}

// A worker can receive input when it isn't mid-turn ('active') and isn't
// blocked on an interactive prompt ('waiting' — injecting there would answer
// the pending prompt instead of starting a new turn), isn't holding a
// StopFailure that hasn't yet cleared, and no human typed in it moments ago.
function isDeliverable(state: AppState, workerSessionId: string): boolean {
  const meta = state.terminalSessionMeta.get(workerSessionId);
  if (meta?.dormant) return false;
  const activity = meta?.activityState;
  if (!(activity == null || activity === 'idle' || activity === 'done')) return false;

  return metaHoldRemainingMs(state, workerSessionId) === 0;
}

const TERMINAL_REPORT_RE =
  /^(?:\x1b\[(?:[IO]|<[\d;]*[Mm]|[?>]?[\d;]*[Rc])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/;

/**
 * Stamps the session when a browser input frame carries real keystrokes.
 * xterm's automatic focus and cursor-position replies do not count as typing.
 */
export function recordHumanInput(state: AppState, sessionId: string, frame: string): void {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (!meta) return;
  try {
    const { d } = JSON.parse(frame) as { d?: unknown };
    if (typeof d !== 'string' || d === '' || TERMINAL_REPORT_RE.test(d)) return;
    meta.lastHumanInputAt = Date.now();
  } catch {
    return;
  }
}

function pruneOldDispatches(state: AppState, now: number): void {
  for (const id of pruneSettledDispatches(now - DISPATCH_RETENTION_MS)) {
    state.dispatchWaiters.delete(id);
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
  const inboxBusy = hasQueuedDispatch(workerSessionId);
  const writtenHold = writtenHoldRemainingMs(workerSessionId) > 0;
  insertDispatch(entry);

  if (isDeliverable(state, workerSessionId) && !inboxBusy && !writtenHold) {
    deliverDispatch(state, entry);
  } else {
    scheduleHoldRetry(state, workerSessionId);
  }
  return entry;
}

export function failQueuedDispatches(
  state: AppState,
  workerSessionId: string,
  reason: string,
): void {
  for (const entry of listWorkerDispatches(workerSessionId, ['queued'])) {
    settleDispatch(state, entry, 'failed', { error: reason });
  }
}

/** True when a prompt pasted now would start a new turn and not overtake queued dispatch traffic. */
export function canInjectNow(state: AppState, sessionId: string): boolean {
  return (
    isDeliverable(state, sessionId) &&
    writtenHoldRemainingMs(sessionId) === 0 &&
    !hasQueuedDispatch(sessionId) &&
    !hasNotices(sessionId)
  );
}

export function injectPromptToTerminal(state: AppState, sessionId: string, text: string): boolean {
  const meta = state.terminalSessionMeta.get(sessionId);
  const agentTypeId: AgentTypeId | undefined =
    meta?.agentType && isAgentTypeId(meta.agentType) ? meta.agentType : undefined;
  const paste = getAgentType(agentTypeId).paste;

  const pasted = `${BRACKETED_PASTE_START}${text.replace(PASTE_SENTINEL_RE, '')}${BRACKETED_PASTE_END}`;
  if (!injectTerminalInput(state, sessionId, pasted)) return false;
  if (meta) meta.lastPasteAt = Date.now();

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

function hasSessionEndpoint(state: AppState, sessionId: string): boolean {
  return state.terminalSessionMeta.get(sessionId)?.command?.includes(`/mcp/${sessionId}`) ?? false;
}

function deliverDispatch(state: AppState, entry: DispatchEntry): void {
  const contract = replyContract(
    entry.correlationId,
    hasSessionEndpoint(state, entry.workerSessionId),
  );
  if (!injectPromptToTerminal(state, entry.workerSessionId, `${entry.message}\n\n${contract}`)) {
    settleDispatch(state, entry, 'failed', { error: 'No daemon connected' });
    return;
  }

  entry.status = 'written';
  entry.writtenAt = Date.now();
  saveDispatch(entry);
  const agentType = state.terminalSessionMeta.get(entry.workerSessionId)?.agentType ?? 'shell';
  console.log(
    `[dispatch] written ${entry.correlationId} to ${entry.workerSessionId.slice(0, 8)} (${agentType})`,
  );
}

/**
 * Deliver queued reply notices and the next queued dispatch for a terminal
 * that just went idle. Returns true when something was pasted.
 */
export function flushDispatchInbox(state: AppState, workerSessionId: string): boolean {
  if (state.terminalSessionMeta.get(workerSessionId)?.dispatchOptOut) {
    failQueuedDispatches(state, workerSessionId, OPT_OUT_REASON);
  }
  if (!isDeliverable(state, workerSessionId) || writtenHoldRemainingMs(workerSessionId) > 0) {
    scheduleHoldRetry(state, workerSessionId);
    return false;
  }

  // Reply notices first — they are informational and cheap; all pending ones
  // are combined into a single paste so one idle transition drains them.
  const notices = listNotices(workerSessionId);
  if (notices.length > 0) {
    const text = notices.map((notice) => notice.text).join('\n\n');
    if (injectPromptToTerminal(state, workerSessionId, text)) {
      deleteNotices(notices.map((notice) => notice.id));
    } else {
      console.warn(`[dispatch] notice flush failed for ${workerSessionId.slice(0, 8)} — kept`);
    }
    // The paste flips the terminal to active; the next act→idle transition
    // flushes the dispatch inbox.
    return true;
  }

  // One at a time: the delivery flips the worker to active; the next act→idle
  // transition flushes the next entry.
  const [next] = listWorkerDispatches(workerSessionId, ['queued']);
  if (!next) return false;
  deliverDispatch(state, next);
  return true;
}

const NOTICE_RESULT_MAX_CHARS = 2_000;

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function describeEvidence(evidence: StoredEvidence | undefined): string {
  if (!evidence) return '';
  const parts: string[] = [];
  if (evidence.commit) {
    const verified = evidence.commitVerified ? ` (${evidence.commitVerified})` : '';
    parts.push(`commit ${evidence.commit}${verified}`);
  }
  if (evidence.commands?.length) {
    const failed = evidence.commands.filter((command) => command.exitCode !== 0).length;
    parts.push(`${pluralize(evidence.commands.length, 'command')}, ${failed} failed`);
  }
  if (evidence.filesChanged?.length) {
    parts.push(`${pluralize(evidence.filesChanged.length, 'file')} changed`);
  }
  if (evidence.notVerified?.length) {
    parts.push(`${evidence.notVerified.length} not verified`);
  }
  return parts.length > 0 ? `\nEvidence: ${parts.join('; ')}` : '';
}

function describeOutcome(entry: DispatchEntry): string {
  switch (entry.status) {
    case 'replied':
      return `replied: ${(entry.result ?? '').slice(0, NOTICE_RESULT_MAX_CHARS)}${describeEvidence(entry.evidence)}`;
    case 'stopped':
      return (
        `stopped without calling terminal_reply (${entry.stopReason ?? 'turn ended'}). ` +
        `Last output: ${(entry.lastOutput ?? '').slice(0, NOTICE_RESULT_MAX_CHARS)}`
      );
    default:
      return `failed: ${entry.error ?? 'unknown error'}`;
  }
}

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
  const label =
    worker?.description ??
    state.terminalSessionMeta.get(entry.workerSessionId)?.scopeLabel ??
    entry.workerSessionId.slice(0, 8);
  // Marker deliberately distinct from the [engy-dispatch] contract so the
  // origin agent cannot mistake the notice for a new dispatched request.
  const notice =
    `[engy-notice ${entry.correlationId}] Worker "${label}" ` +
    `${describeOutcome(entry)}\n(Informational — your earlier terminal_dispatch settled. Do not reply or re-dispatch because of this notice.)`;

  // Direct-inject only when nothing else is queued for the origin — pending
  // notices or dispatches would otherwise be overtaken out of arrival order.
  if (canInjectNow(state, origin) && injectPromptToTerminal(state, origin, notice)) return;
  pushNotice(origin, notice);
  scheduleHoldRetry(state, origin);
}

interface SettleFields {
  result?: string;
  error?: string;
  settledBy?: DispatchEntry['settledBy'];
  stopReason?: string;
  lastOutput?: string;
  evidence?: StoredEvidence;
}

export function settleDispatch(
  state: AppState,
  entry: DispatchEntry,
  status: 'replied' | 'stopped' | 'failed',
  fields: SettleFields = {},
): void {
  entry.status = status;
  entry.result = fields.result;
  entry.error = fields.error;
  entry.settledBy = fields.settledBy;
  entry.stopReason = fields.stopReason;
  entry.lastOutput = fields.lastOutput;
  entry.evidence = fields.evidence;
  entry.repliedAt = Date.now();
  saveDispatch(entry);
  const waiters = state.dispatchWaiters.get(entry.correlationId);
  state.dispatchWaiters.delete(entry.correlationId);
  if (waiters) {
    for (const waiter of waiters) waiter(entry);
  }
  if (entry.notifyOnReply) {
    notifyOrigin(state, entry);
  }
}

function isFinal(entry: DispatchEntry): boolean {
  return entry.status === 'replied' || entry.status === 'failed';
}

// A 'written' or 'delivered' entry that never receives a reply (worker ignored
// the contract, or the daemon dropped between paste and Enter) is recovered by:
// the sync dispatch timeout returning the pending status with a collect hint,
// terminal_collect polling, the Stop hook marking it 'stopped', or
// failWorkerDispatches when the worker terminal exits. Silence alone never
// fails a dispatch.
/** Called by the terminal_reply MCP tool. Returns false for unknown/settled ids. */
export function resolveDispatchReply(
  state: AppState,
  correlationId: string,
  result: string,
  evidence?: StoredEvidence,
): boolean {
  const entry = getDispatch(correlationId);
  if (!entry || isFinal(entry)) return false;
  settleDispatch(state, entry, 'replied', { result, settledBy: 'reply', evidence });
  console.log(`[dispatch] reply for ${correlationId} (${result.length} chars)`);
  return true;
}

function findTargetForWorkerReply(
  state: AppState,
  workerSessionId: string,
): DispatchEntry | undefined {
  const currentPromptId = state.terminalSessionMeta.get(workerSessionId)?.currentPromptId;
  const inFlight = listWorkerDispatches(workerSessionId, ['delivered', 'written']);

  const ofCurrentTurn = inFlight.find(
    (entry) => entry.status === 'delivered' && entry.deliveryPromptId === currentPromptId,
  );
  if (ofCurrentTurn) return ofCurrentTurn;
  if (inFlight.length > 0) return inFlight.length === 1 ? inFlight[0] : undefined;

  const lateStopped = listWorkerDispatches(workerSessionId, ['stopped']).at(-1);
  const stoppedRecently =
    lateStopped?.repliedAt != null && Date.now() - lateStopped.repliedAt < LATE_REPLY_WINDOW_MS;
  const noNewTurnSince =
    lateStopped?.deliveryPromptId !== undefined && lateStopped.deliveryPromptId === currentPromptId;
  return stoppedRecently && noNewTurnSince ? lateStopped : undefined;
}

/**
 * Settle a reply from an identified worker without a correlation id. The row
 * tagged by the worker's current turn wins; otherwise the single in-flight row
 * ('written' counts, for CLIs without hooks); otherwise the newest 'stopped'
 * row when no new turn opened since its Stop and it stopped under 10 minutes
 * ago. With several candidates the reply is refused and the worker must pass
 * the id.
 */
export function resolveWorkerReply(
  state: AppState,
  workerSessionId: string,
  result: string,
  evidence?: StoredEvidence,
): DispatchEntry | null {
  const target = findTargetForWorkerReply(state, workerSessionId);
  if (!target) return null;
  settleDispatch(state, target, 'replied', { result, settledBy: 'reply', evidence });
  console.log(
    `[dispatch] reply for ${target.correlationId} via worker identity ${workerSessionId.slice(0, 8)} (${result.length} chars)`,
  );
  return target;
}

/** Fail every unsettled dispatch for a worker (terminal exited / killed). */
export function failWorkerDispatches(
  state: AppState,
  workerSessionId: string,
  reason: string,
): void {
  for (const entry of listWorkerDispatches(workerSessionId, ['queued', 'written', 'delivered'])) {
    settleDispatch(state, entry, 'failed', { error: reason });
  }
}

/**
 * Wait for a dispatch to settle. Resolves with the entry's state at timeout —
 * callers distinguish by `status` (settled vs still pending).
 */
export function waitForDispatchReply(
  state: AppState,
  correlationId: string,
  timeoutMs: number,
): Promise<DispatchEntry> {
  const entry = getDispatch(correlationId);
  if (!entry) return Promise.reject(new Error(`Unknown correlationId: ${correlationId}`));
  if (SETTLED_STATUSES.includes(entry.status)) return Promise.resolve(entry);

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
      resolve(getDispatch(correlationId) ?? entry);
    }, timeoutMs);
    timer.unref?.();
  });
}

// ── Agent-originated spawn (terminal_spawn) ─────────────────────────

const SPAWN_DEPTH_LIMIT = 2;
export const SPAWN_COUNT_LIMIT = 5;
export const SPAWN_WARN_ABOVE = 3;
const SPAWN_RATE_LIMIT = 10;
const SPAWN_RATE_WINDOW_MS = 10 * 60_000;

const SPAWNED_TERMINAL_COLS = 80;
const SPAWNED_TERMINAL_ROWS = 24;

export function countAgentSpawnedSessions(state: AppState): number {
  let count = 0;
  for (const meta of state.terminalSessionMeta.values()) {
    if (meta.spawnedBy && meta.spawnedBy !== AUTO_REVIEW_SPAWNER) count++;
  }
  return count;
}

/**
 * Returns the reason a spawn must be refused, or null. Depth bounds spawn
 * chains (claude → codex → claude → …), count bounds fan-out, and the rate
 * limit bounds close-and-respawn loops that free a count slot each round.
 * Records the attempt, so a caller cannot retry past the rate limit.
 */
export function checkSpawnLimits(
  state: AppState,
  callerSessionId: string,
  callerMeta: TerminalSessionMeta,
): string | null {
  const depth = (callerMeta.spawnDepth ?? 0) + 1;
  if (depth > SPAWN_DEPTH_LIMIT) {
    return `Spawn depth limit reached (${SPAWN_DEPTH_LIMIT}): this terminal was spawned by an agent chain that is already ${callerMeta.spawnDepth} deep. Do the work yourself or dispatch to an existing worker.`;
  }
  const live = countAgentSpawnedSessions(state);
  if (live >= SPAWN_COUNT_LIMIT) {
    return `Agent-spawned terminal limit reached (${SPAWN_COUNT_LIMIT} live). Reuse an existing worker via terminal_dispatch, or terminal_close one you spawned to free a slot.`;
  }
  const now = Date.now();
  const recent = (state.spawnAttempts.get(callerSessionId) ?? []).filter(
    (at) => now - at < SPAWN_RATE_WINDOW_MS,
  );
  if (recent.length >= SPAWN_RATE_LIMIT) {
    state.spawnAttempts.set(callerSessionId, recent);
    return `Spawn rate limit reached (${SPAWN_RATE_LIMIT} spawns in ${SPAWN_RATE_WINDOW_MS / 60_000} minutes). Reuse an existing worker; ask the user before spawning more.`;
  }
  recent.push(now);
  state.spawnAttempts.set(callerSessionId, recent);
  return null;
}

export interface SpawnScope {
  scopeType: string;
  groupKey?: string;
  workspaceSlug?: string;
  projectId?: number;
  projectSlug?: string;
  worktreeBranch?: string;
}

interface SpawnAgentTerminalOptions {
  agentType: AgentTypeId;
  workingDir: string;
  description: string;
  prompt?: string;
  /** Caller terminal session id — recorded as the spawn origin. */
  spawnedBy?: string;
  spawnDepth?: number;
  scope: SpawnScope;
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

  const { scope } = opts;
  daemon.send(
    JSON.stringify({
      t: 'spawn',
      sessionId,
      workingDir: opts.workingDir,
      command,
      cols: SPAWNED_TERMINAL_COLS,
      rows: SPAWNED_TERMINAL_ROWS,
      scopeType: scope.scopeType,
      scopeLabel: opts.description,
    } satisfies TerminalSpawnCmd),
  );

  const meta: TerminalSessionMeta = {
    scopeType: scope.scopeType,
    scopeLabel: opts.description,
    workingDir: opts.workingDir,
    command,
    agentType: opts.agentType,
    containerMode: 'host',
    groupKey: scope.groupKey,
    workspaceSlug: scope.workspaceSlug,
    projectId: scope.projectId,
    projectSlug: scope.projectSlug,
    worktreeBranch: scope.worktreeBranch,
    spawnedBy: opts.spawnedBy,
    spawnDepth: opts.spawnDepth,
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
  if (opts.spawnedBy) connectWorker(state, sessionId, opts.description);
  broadcastTerminalSessionsChange('created', sessionId, scope.groupKey);
  console.log(
    `[dispatch] agent-spawned ${opts.agentType} terminal ${sessionId.slice(0, 8)} by ${opts.spawnedBy?.slice(0, 8) ?? 'user'}`,
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
  dropSessionDispatchState(state, sessionId);
  clearLiveTargetsForSession(state, sessionId);
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

function updateDispatchFlags(
  state: AppState,
  sessionId: string,
  apply: (meta: TerminalSessionMeta) => void,
): void {
  const meta = state.terminalSessionMeta.get(sessionId);
  if (!meta) return;
  apply(meta);
  persistTerminalSession(sessionId, meta);
  broadcastTerminalWorkersChange(sessionId, state.dispatchWorkers.has(sessionId));
}

export function setOrchestrator(state: AppState, sessionId: string, enabled: boolean): void {
  if (enabled) {
    for (const [otherId, other] of state.terminalSessionMeta) {
      if (otherId !== sessionId && other.orchestrator) {
        updateDispatchFlags(state, otherId, (meta) => {
          meta.orchestrator = undefined;
        });
      }
    }
  }
  updateDispatchFlags(state, sessionId, (meta) => {
    meta.orchestrator = enabled || undefined;
  });
}

export function setDispatchOptOut(state: AppState, sessionId: string, optOut: boolean): void {
  updateDispatchFlags(state, sessionId, (meta) => {
    meta.dispatchOptOut = optOut || undefined;
  });
  if (optOut) failQueuedDispatches(state, sessionId, OPT_OUT_REASON);
}

export function isTrackedWorker(state: AppState, sessionId: string): boolean {
  return state.terminalSessionMeta.get(sessionId)?.agentType != null;
}

export function recordWorkerOutput(state: AppState, sessionId: string, chunk: string): void {
  const existing = state.terminalOutputTails.get(sessionId) ?? '';
  const combined = existing + chunk;
  state.terminalOutputTails.set(
    sessionId,
    combined.length > OUTPUT_TAIL_MAX_CHARS ? combined.slice(-OUTPUT_TAIL_MAX_CHARS) : combined,
  );
}

export function getWorkerOutputTail(state: AppState, sessionId: string, lines: number): string {
  const raw = state.terminalOutputTails.get(sessionId) ?? '';
  const clean = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r+\n/g, '\n')
    .replace(/\r/g, '\n');
  return clean.split('\n').slice(-lines).join('\n');
}
