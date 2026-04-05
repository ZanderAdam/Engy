import { WebSocket } from 'ws';
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
  };
}

type ServerEvent =
  | FileChangeEvent
  | TaskChangeEvent
  | QuestionChangeEvent
  | TerminalSessionsChangeEvent;

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
): void {
  broadcastEvent({
    type: 'TERMINAL_SESSIONS_CHANGE',
    payload: { action, sessionId, groupKey, newLabel },
  });
}
