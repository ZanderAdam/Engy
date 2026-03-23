import { WebSocket } from 'ws';
import { getAppState } from '../trpc/context';

// ── Event Types ─────────────────────────────────────────────────────

export interface TaskChangeEvent {
  type: 'TASK_CHANGE';
  payload: {
    action: 'created' | 'updated' | 'deleted';
    taskId: number;
    projectId?: number;
  };
}

export interface QuestionChangeEvent {
  type: 'QUESTION_CHANGE';
  payload: {
    action: 'created' | 'answered';
    taskId?: number;
    sessionId?: string;
  };
}

export type ServerEvent = TaskChangeEvent | QuestionChangeEvent;

// ── Generic Broadcast ───────────────────────────────────────────────

function broadcastEvent(event: ServerEvent): void {
  const state = getAppState();
  const msg = JSON.stringify(event);
  for (const ws of state.fileChangeListeners) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── Typed Wrappers ──────────────────────────────────────────────────

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
