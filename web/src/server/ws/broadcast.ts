import { WebSocket } from 'ws';
import type { TerminalActivityState } from '@engy/common';
import { getAppState } from '../trpc/context';

// ── Event Types ─────────────────────────────────────────────────────

interface FileChangeEvent {
  type: 'FILE_CHANGE';
  payload: {
    workspaceSlug: string;
    path: string;
    eventType: 'add' | 'change' | 'unlink';
  };
}

interface TaskChangeEvent {
  type: 'TASK_CHANGE';
  payload: {
    action: 'created' | 'updated' | 'deleted';
    taskId: number;
    projectId?: number;
  };
}

interface QuestionChangeEvent {
  type: 'QUESTION_CHANGE';
  payload: {
    action: 'created' | 'answered';
    taskId?: number;
    sessionId?: string;
  };
}

interface TerminalSessionsChangeEvent {
  type: 'TERMINAL_SESSIONS_CHANGE';
  payload: {
    action: 'created' | 'destroyed' | 'attached' | 'detached' | 'renamed';
    sessionId: string;
    groupKey?: string;
    newLabel?: string;
    // 'killed' = deliberate teardown (user kill / terminal_close) — the UI
    // removes the tab. A natural PTY exit omits it so the tab stays visible
    // with its final output.
    reason?: 'killed';
  };
}

interface MemoryChangeEvent {
  type: 'MEMORY_CHANGE';
  payload: {
    action: 'created' | 'updated' | 'deleted' | 'promoted';
    workspaceId: number;
    memoryId?: number;
  };
}

interface TerminalActivityChangeEvent {
  type: 'TERMINAL_ACTIVITY_CHANGE';
  payload: {
    sessionId: string;
    projectSlug?: string;
    state?: TerminalActivityState;
    // True when the session ended — consumers drop it from the rollup.
    removed?: boolean;
  };
}

interface PrChangeEvent {
  type: 'PR_CHANGE';
  payload: {
    workspaceId: number;
    repo: string;
  };
}

interface PrAttentionEvent {
  type: 'PR_ATTENTION';
  payload: {
    workspaceId: number;
    repo: string;
    prNumber: number;
    reason: string;
  };
}

interface TerminalWorkersChangeEvent {
  type: 'TERMINAL_WORKERS_CHANGE';
  payload: {
    sessionId: string;
    connected: boolean;
  };
}

type ServerEvent =
  | FileChangeEvent
  | TaskChangeEvent
  | QuestionChangeEvent
  | TerminalSessionsChangeEvent
  | MemoryChangeEvent
  | TerminalActivityChangeEvent
  | PrChangeEvent
  | PrAttentionEvent
  | TerminalWorkersChangeEvent;

// ── Generic Broadcast ───────────────────────────────────────────────

function broadcastEvent(event: ServerEvent): void {
  const state = getAppState();
  const msg = JSON.stringify(event);
  for (const ws of state.fileChangeListeners) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── Typed Wrappers ──────────────────────────────────────────────────

export function broadcastFileChange(
  workspaceSlug: string,
  path: string,
  eventType: 'add' | 'change' | 'unlink',
): void {
  broadcastEvent({
    type: 'FILE_CHANGE',
    payload: { workspaceSlug, path, eventType },
  });
}

export function broadcastTaskChange(
  action: TaskChangeEvent['payload']['action'],
  taskId: number,
  projectId?: number,
): void {
  broadcastEvent({
    type: 'TASK_CHANGE',
    payload: { action, taskId, projectId },
  });
}

export function broadcastQuestionChange(
  action: QuestionChangeEvent['payload']['action'],
  taskId?: number,
  sessionId?: string,
): void {
  broadcastEvent({
    type: 'QUESTION_CHANGE',
    payload: { action, taskId, sessionId },
  });
}

export function broadcastTerminalSessionsChange(
  action: TerminalSessionsChangeEvent['payload']['action'],
  sessionId: string,
  groupKey?: string,
  newLabel?: string,
  reason?: 'killed',
): void {
  broadcastEvent({
    type: 'TERMINAL_SESSIONS_CHANGE',
    payload: { action, sessionId, groupKey, newLabel, reason },
  });
}

export function broadcastMemoryChange(
  action: MemoryChangeEvent['payload']['action'],
  workspaceId: number,
  memoryId?: number,
): void {
  broadcastEvent({
    type: 'MEMORY_CHANGE',
    payload: { action, workspaceId, memoryId },
  });
}

export function broadcastTerminalActivityChange(
  payload: TerminalActivityChangeEvent['payload'],
): void {
  broadcastEvent({ type: 'TERMINAL_ACTIVITY_CHANGE', payload });
}

export function broadcastPrChange(workspaceId: number, repo: string): void {
  broadcastEvent({ type: 'PR_CHANGE', payload: { workspaceId, repo } });
}

export function broadcastPrAttention(
  workspaceId: number,
  repo: string,
  prNumber: number,
  reason: string,
): void {
  broadcastEvent({ type: 'PR_ATTENTION', payload: { workspaceId, repo, prNumber, reason } });
}

export function broadcastTerminalWorkersChange(sessionId: string, connected: boolean): void {
  broadcastEvent({ type: 'TERMINAL_WORKERS_CHANGE', payload: { sessionId, connected } });
}
