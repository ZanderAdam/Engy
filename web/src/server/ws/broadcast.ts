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
    action: 'created' | 'updated' | 'deleted' | 'promoted' | 'dismissed' | 'restored';
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
    // True once a hook event has landed for this session — the browser tab
    // badge trusts this state over its own PTY-parsed heuristic when set.
    hookDriven?: boolean;
  };
}

interface TerminalBranchChangeEvent {
  type: 'TERMINAL_BRANCH_CHANGE';
  payload: {
    sessionId: string;
    worktreeBranch: string;
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

interface CommentChangeEvent {
  type: 'COMMENT_CHANGE';
  payload: {
    documentPath: string;
    threadId: string;
  };
}

interface TerminalWorkersChangeEvent {
  type: 'TERMINAL_WORKERS_CHANGE';
  payload: {
    sessionId: string;
    connected: boolean;
  };
}

// An agent asking to be heard. Carries the terminal it came from so the
// browser can attribute the voice to a session, and so a future per-terminal
// mute has something to key on.
interface VoiceSpeakEvent {
  type: 'VOICE_SPEAK';
  payload: {
    text: string;
    // Carried so only the workspace that was spoken to hears it — broadcasts
    // reach every open browser, whatever workspace it is showing.
    workspaceSlug?: string;
    sessionId?: string;
    scopeLabel?: string;
  };
}

type ServerEvent =
  | FileChangeEvent
  | TaskChangeEvent
  | QuestionChangeEvent
  | TerminalSessionsChangeEvent
  | MemoryChangeEvent
  | TerminalActivityChangeEvent
  | TerminalBranchChangeEvent
  | PrChangeEvent
  | PrAttentionEvent
  | TerminalWorkersChangeEvent
  | VoiceSpeakEvent
  | CommentChangeEvent;

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

export function broadcastTerminalBranchChange(sessionId: string, worktreeBranch: string): void {
  broadcastEvent({ type: 'TERMINAL_BRANCH_CHANGE', payload: { sessionId, worktreeBranch } });
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

export function broadcastVoiceSpeak(payload: VoiceSpeakEvent['payload']): void {
  broadcastEvent({ type: 'VOICE_SPEAK', payload });
}

export function broadcastCommentChange(documentPath: string, threadId: string): void {
  broadcastEvent({ type: 'COMMENT_CHANGE', payload: { documentPath, threadId } });
}
