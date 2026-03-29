import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { eq } from 'drizzle-orm';
import type {
  ClientToServerMessage,
  ValidatePathsRequestMessage,
  SearchFilesRequestMessage,
  ContainerUpRequestMessage,
  ExecutionStartConfig,
} from '@engy/common';
import type { AppState, FileChangeEvent, GitStatusResult, GitLogResult, GitShowResult, GitBranchFilesResult, ContainerUpResult, ExecutionStartResult, ExecutionStopResult, DirListResult, FileReadResult, FileWriteResult } from '../trpc/context';
import { getDb } from '../db/client';
import { workspaces, agentSessions, tasks } from '../db/schema';
import { handleSpecFileChange } from '../spec/watcher';
import { broadcastFileChange, broadcastTaskChange } from './broadcast';

const MAX_EVENTS_PER_WORKSPACE = 100;
const VALIDATION_TIMEOUT_MS = 5_000;
const FILE_SEARCH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 15_000;
const CONTAINER_TIMEOUT_MS = 300_000;

export function createWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws-main-server] New connection');

    ws.on('message', (raw: Buffer | string) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      } catch {
        return;
      }

      handleMessage(ws, msg, state);
    });

    ws.on('close', (code, reason) => {
      const wasDaemon = state.daemon === ws;
      console.log(
        `[ws-main-server] Connection closed: code=${code} reason=${reason?.toString() ?? ''} wasDaemon=${wasDaemon}`,
      );
      if (wasDaemon) {
        state.daemon = null;
        rejectAllPending(state);
      }
    });

    ws.on('error', (err) => {
      console.error(`[ws-main-server] Error: ${err.message}`);
    });
  });

  return wss;
}

function rejectAllPending(state: AppState): void {
  const pendingMaps = [
    state.pendingValidations,
    state.pendingFileSearches,
    state.pendingGitStatus,
    state.pendingGitLog,
    state.pendingGitShow,
    state.pendingGitBranchFiles,
    state.pendingContainerUp,
    state.pendingContainerDown,
    state.pendingContainerStatus,
    state.pendingExecutionStart,
    state.pendingExecutionStop,
    state.pendingDirList,
    state.pendingFileRead,
    state.pendingFileWrite,
  ] as const;

  const error = new Error('Daemon disconnected');
  for (const map of pendingMaps) {
    for (const [id, pending] of map) {
      map.delete(id);
      pending.reject(error);
    }
  }
}

function handleMessage(ws: WebSocket, msg: ClientToServerMessage, state: AppState): void {
  switch (msg.type) {
    case 'REGISTER':
      handleRegister(ws, state);
      break;
    case 'VALIDATE_PATHS_RESPONSE':
      handleValidatePathsResponse(msg, state);
      break;
    case 'SEARCH_FILES_RESPONSE':
      handleSearchFilesResponse(msg, state);
      break;
    case 'FILE_CHANGE':
      handleFileChange(msg, state);
      break;
    case 'GIT_STATUS_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingGitStatus, (p) => ({
        files: p.files,
        branch: p.branch,
      }));
      break;
    case 'GIT_LOG_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingGitLog, (p) => ({
        commits: p.commits,
      }));
      break;
    case 'GIT_SHOW_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingGitShow, (p) => ({
        diff: p.diff,
        files: p.files,
      }));
      break;
    case 'GIT_BRANCH_FILES_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingGitBranchFiles, (p) => ({
        files: p.files,
      }));
      break;
    case 'CONTAINER_UP_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingContainerUp, (p) => ({
        containerId: p.containerId,
      }));
      break;
    case 'CONTAINER_DOWN_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingContainerDown, (p) => ({
        success: p.success,
      }));
      break;
    case 'CONTAINER_STATUS_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingContainerStatus, (p) => ({
        running: p.running,
        containerId: p.containerId,
      }));
      break;
    case 'CONTAINER_PROGRESS_EVENT': {
      const listener = state.containerProgressListeners.get(msg.payload.requestId);
      if (listener) listener(msg.payload.line);
      break;
    }
    case 'EXECUTION_START_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingExecutionStart, (p) => ({
        sessionId: p.sessionId,
      }));
      break;
    case 'EXECUTION_STOP_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingExecutionStop, (p) => ({
        success: p.success,
      }));
      break;
    case 'DIR_LIST_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingDirList, (p) => ({
        dirs: p.dirs,
        files: p.files,
      }));
      break;
    case 'FILE_READ_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingFileRead, (p) => ({
        content: p.content,
      }));
      break;
    case 'FILE_WRITE_RESPONSE':
      resolvePendingResponse(msg.payload, state.pendingFileWrite, (p) => ({
        success: p.success,
      }));
      break;
    case 'EXECUTION_STATUS_EVENT':
      handleExecutionStatusEvent(msg.payload);
      break;
    case 'EXECUTION_COMPLETE_EVENT':
      handleExecutionCompleteEvent(msg.payload);
      break;
  }
}

function handleRegister(ws: WebSocket, state: AppState): void {
  const oldDaemon = state.daemon !== ws ? state.daemon : null;
  console.log(`[ws-main-server] REGISTER: hadOldDaemon=${oldDaemon !== null}`);

  // Replace first, then terminate the old one. terminate() (not close()) sends no
  // close frame, so the client's closure guard (this.ws !== ws) handles it silently.
  state.daemon = ws;
  if (oldDaemon) {
    oldDaemon.terminate();
  }

  try {
    const db = getDb();
    const allWorkspaces = db.select().from(workspaces).all();
    const syncPayload = allWorkspaces.map((w) => ({
      slug: w.slug,
      repos: (w.repos as string[]) ?? [],
      docsDir: w.docsDir,
    }));

    ws.send(
      JSON.stringify({
        type: 'WORKSPACES_SYNC',
        payload: { workspaces: syncPayload },
      }),
    );
    console.log(`[ws-main-server] Sent WORKSPACES_SYNC with ${syncPayload.length} workspaces`);
  } catch (err) {
    console.error('[ws-main-server] Failed to send WORKSPACES_SYNC:', err);
  }
}

function handleValidatePathsResponse(
  msg: { payload: { requestId: string; results: Array<{ path: string; exists: boolean }> } },
  state: AppState,
): void {
  const pending = state.pendingValidations.get(msg.payload.requestId);
  if (!pending) return;

  state.pendingValidations.delete(msg.payload.requestId);
  pending.resolve(msg.payload.results);
}

function handleFileChange(
  msg: { payload: { workspaceSlug: string; path: string; eventType: 'add' | 'change' | 'unlink' } },
  state: AppState,
): void {
  const { workspaceSlug, path, eventType } = msg.payload;
  const event: FileChangeEvent = { workspaceSlug, path, eventType, timestamp: Date.now() };

  let events = state.fileChanges.get(workspaceSlug);
  if (!events) {
    events = [];
    state.fileChanges.set(workspaceSlug, events);
  }

  events.push(event);

  if (events.length > MAX_EVENTS_PER_WORKSPACE) {
    events.splice(0, events.length - MAX_EVENTS_PER_WORKSPACE);
  }

  if (path.includes('/projects/') || path.includes('\\projects\\')) {
    handleSpecFileChange(workspaceSlug, state);
  }

  broadcastFileChange(workspaceSlug, path, eventType);
}

function handleSearchFilesResponse(
  msg: { payload: { requestId: string; results: Array<{ label: string; path: string }> } },
  state: AppState,
): void {
  const pending = state.pendingFileSearches.get(msg.payload.requestId);
  if (!pending) return;

  state.pendingFileSearches.delete(msg.payload.requestId);
  pending.resolve(msg.payload.results);
}

// ── Execution event handlers ────────────────────────────────────────────────

function handleExecutionStatusEvent(payload: {
  sessionId: string;
  status: string;
  taskId?: number;
  worktreePath?: string;
}): void {
  console.log(
    `[ws-main-server] Execution status: session=${payload.sessionId} status=${payload.status}`,
  );

  const db = getDb();
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.sessionId, payload.sessionId))
    .get();

  if (!session) {
    console.warn(
      `[ws-main-server] EXECUTION_STATUS_EVENT for unknown session: ${payload.sessionId}`,
    );
    return;
  }

  const now = new Date().toISOString();
  const updateFields: { updatedAt: string; worktreePath?: string } = { updatedAt: now };
  if (payload.worktreePath) updateFields.worktreePath = payload.worktreePath;
  db.update(agentSessions)
    .set(updateFields)
    .where(eq(agentSessions.sessionId, payload.sessionId))
    .run();

  const taskId = payload.taskId ?? session.taskId;
  if (taskId) {
    const subStatus = payload.status as typeof tasks.$inferInsert.subStatus;
    db.update(tasks).set({ subStatus, updatedAt: now }).where(eq(tasks.id, taskId)).run();
    broadcastTaskChange('updated', taskId);
  }
}

function handleExecutionCompleteEvent(payload: {
  sessionId: string;
  exitCode: number;
  success: boolean;
  completionSummary?: string;
}): void {
  console.log(
    `[ws-main-server] Execution complete: session=${payload.sessionId} exitCode=${payload.exitCode} success=${payload.success}`,
  );

  const db = getDb();
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.sessionId, payload.sessionId))
    .get();

  if (!session) {
    console.warn(
      `[ws-main-server] EXECUTION_COMPLETE_EVENT for unknown session: ${payload.sessionId}`,
    );
    return;
  }

  const now = new Date().toISOString();

  // Check if the task is blocked (agent called askQuestion or awaiting feedback)
  let taskBlocked = false;
  if (session.taskId) {
    const currentTask = db.select().from(tasks).where(eq(tasks.id, session.taskId)).get();
    if (currentTask?.subStatus === 'blocked') {
      taskBlocked = true;
    }
  }

  db.transaction((tx) => {
    if (taskBlocked) {
      // Agent exited while task is blocked — pause session, preserve blocked state
      tx.update(agentSessions)
        .set({
          status: 'paused',
          completionSummary: payload.completionSummary ?? null,
          updatedAt: now,
        })
        .where(eq(agentSessions.sessionId, payload.sessionId))
        .run();
    } else {
      // Remote sessions stay as 'submitted' — just update the summary
      const isRemote = session.status === 'submitted';
      const sessionStatus = isRemote ? 'submitted' : payload.success ? 'completed' : 'stopped';

      tx.update(agentSessions)
        .set({
          status: sessionStatus,
          completionSummary: payload.completionSummary ?? null,
          updatedAt: now,
        })
        .where(eq(agentSessions.sessionId, payload.sessionId))
        .run();

      // Remote sessions: don't update task status — work is still running in the cloud
      if (session.taskId && !isRemote) {
        if (payload.success) {
          tx.update(tasks)
            .set({ status: 'done', subStatus: null, updatedAt: now })
            .where(eq(tasks.id, session.taskId))
            .run();
        } else {
          tx.update(tasks)
            .set({
              subStatus: 'failed' as typeof tasks.$inferInsert.subStatus,
              updatedAt: now,
            })
            .where(eq(tasks.id, session.taskId))
            .run();
        }
      }
    }
  });

  if (session.taskId) {
    broadcastTaskChange('updated', session.taskId);
  }
}

export function dispatchFileSearch(
  dirs: string[],
  query: string,
  limit: number,
  state: AppState,
  timeoutMs: number = FILE_SEARCH_TIMEOUT_MS,
): Promise<Array<{ label: string; path: string }>> {
  return new Promise((resolve, reject) => {
    if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) {
      reject(new Error('No daemon connected'));
      return;
    }

    const requestId = randomUUID();

    const timeout = setTimeout(() => {
      state.pendingFileSearches.delete(requestId);
      reject(new Error(`File search timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    state.pendingFileSearches.set(requestId, {
      resolve: (results) => {
        clearTimeout(timeout);
        resolve(results);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });

    const message: SearchFilesRequestMessage = {
      type: 'SEARCH_FILES_REQUEST',
      payload: { requestId, dirs, query, limit },
    };

    state.daemon.send(JSON.stringify(message));
  });
}

export function dispatchValidation(
  paths: string[],
  state: AppState,
  timeoutMs: number = VALIDATION_TIMEOUT_MS,
): Promise<Array<{ path: string; exists: boolean }>> {
  return new Promise((resolve, reject) => {
    if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) {
      reject(new Error('No daemon connected'));
      return;
    }

    const requestId = randomUUID();

    const timeout = setTimeout(() => {
      state.pendingValidations.delete(requestId);
      reject(new Error(`Validation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    state.pendingValidations.set(requestId, {
      resolve: (results) => {
        clearTimeout(timeout);
        resolve(results);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });

    const message: ValidatePathsRequestMessage = {
      type: 'VALIDATE_PATHS_REQUEST',
      payload: { requestId, paths },
    };

    state.daemon.send(JSON.stringify(message));
  });
}

// ── Pending response handler ────────────────────────────────────────────────

function resolvePendingResponse<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  pendingMap: Map<string, { resolve: (result: T) => void; reject: (reason: Error) => void }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extract: (payload: any) => T,
): void {
  const pending = pendingMap.get(payload.requestId);
  if (!pending) return;
  pendingMap.delete(payload.requestId);
  if (payload.error) {
    pending.reject(new Error(payload.error));
  } else {
    pending.resolve(extract(payload));
  }
}

// ── Daemon dispatch functions ───────────────────────────────────────────────

function dispatchDaemonOp<T, P extends object = Record<string, unknown>>(
  state: AppState,
  pendingMap: Map<string, { resolve: (result: T) => void; reject: (reason: Error) => void }>,
  messageType: string,
  payload: P,
  timeoutMs: number = GIT_TIMEOUT_MS,
  explicitRequestId?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) {
      reject(new Error('No daemon connected'));
      return;
    }

    const requestId = explicitRequestId ?? randomUUID();

    if (pendingMap.has(requestId)) {
      reject(new Error(`Duplicate requestId: ${requestId}`));
      return;
    }

    const timeout = setTimeout(() => {
      pendingMap.delete(requestId);
      reject(new Error(`Daemon operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingMap.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });

    state.daemon.send(JSON.stringify({ type: messageType, payload: { requestId, ...payload } }));
  });
}

export function dispatchGitStatus(
  repoDir: string,
  state: AppState,
): Promise<GitStatusResult> {
  return dispatchDaemonOp(state, state.pendingGitStatus, 'GIT_STATUS_REQUEST', { repoDir });
}

export function dispatchGitLog(
  repoDir: string,
  state: AppState,
  maxCount?: number,
): Promise<GitLogResult> {
  return dispatchDaemonOp(state, state.pendingGitLog, 'GIT_LOG_REQUEST', { repoDir, maxCount });
}

export function dispatchGitShow(
  repoDir: string,
  commitHash: string,
  state: AppState,
): Promise<GitShowResult> {
  return dispatchDaemonOp(state, state.pendingGitShow, 'GIT_SHOW_REQUEST', { repoDir, commitHash });
}

export function dispatchGitBranchFiles(
  repoDir: string,
  base: string,
  state: AppState,
): Promise<GitBranchFilesResult> {
  return dispatchDaemonOp(state, state.pendingGitBranchFiles, 'GIT_BRANCH_FILES_REQUEST', { repoDir, base });
}

// ── File dispatch functions ──────────────────────────────────────────────────

export function dispatchDirList(
  dirPath: string,
  state: AppState,
): Promise<DirListResult> {
  return dispatchDaemonOp(state, state.pendingDirList, 'DIR_LIST_REQUEST', { dirPath });
}

export function dispatchFileRead(
  repoDir: string,
  filePath: string,
  state: AppState,
  ref?: string,
): Promise<FileReadResult> {
  return dispatchDaemonOp(state, state.pendingFileRead, 'FILE_READ_REQUEST', {
    repoDir,
    filePath,
    ref,
  });
}

export function dispatchFileWrite(
  repoDir: string,
  filePath: string,
  content: string,
  state: AppState,
): Promise<FileWriteResult> {
  return dispatchDaemonOp(state, state.pendingFileWrite, 'FILE_WRITE_REQUEST', {
    repoDir,
    filePath,
    content,
  });
}

// ── Container dispatch functions ─────────────────────────────────────────────

export function dispatchContainerUp(
  state: AppState,
  workspaceFolder: string,
  repos?: string[],
  config?: ContainerUpRequestMessage['payload']['config'],
  executionBackend?: 'devcontainer' | 'coder',
  coderWorkspace?: string,
  requestId?: string,
): Promise<ContainerUpResult> {
  return dispatchDaemonOp(
    state,
    state.pendingContainerUp,
    'CONTAINER_UP_REQUEST',
    { workspaceFolder, repos, config, executionBackend, coderWorkspace },
    CONTAINER_TIMEOUT_MS,
    requestId,
  );
}

// ── Execution dispatch functions ─────────────────────────────────────────────

const EXECUTION_TIMEOUT_MS = 300_000;

export function dispatchExecutionStart(
  state: AppState,
  sessionId: string,
  prompt: string,
  flags?: string[],
  config?: ExecutionStartConfig,
): Promise<ExecutionStartResult> {
  return dispatchDaemonOp(
    state,
    state.pendingExecutionStart,
    'EXECUTION_START_REQUEST',
    { sessionId, prompt, flags, config },
    EXECUTION_TIMEOUT_MS,
  );
}

export function dispatchExecutionStop(
  state: AppState,
  sessionId: string,
): Promise<ExecutionStopResult> {
  return dispatchDaemonOp(
    state,
    state.pendingExecutionStop,
    'EXECUTION_STOP_REQUEST',
    { sessionId },
  );
}
