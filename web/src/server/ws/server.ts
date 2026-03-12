import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ClientToServerMessage,
  ValidatePathsRequestMessage,
  SearchFilesRequestMessage,
} from '@engy/common';
import type { AppState, FileChangeEvent, GitStatusResult, GitLogResult, GitShowResult, GitBranchFilesResult } from '../trpc/context';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { handleSpecFileChange } from '../spec/watcher';

const MAX_EVENTS_PER_WORKSPACE = 100;
const VALIDATION_TIMEOUT_MS = 5_000;
const FILE_SEARCH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 15_000;

export function createWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (raw: Buffer | string) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      } catch {
        return;
      }

      handleMessage(ws, msg, state);
    });

    ws.on('close', () => {
      if (state.daemon === ws) {
        state.daemon = null;
        rejectAllPending(state);
      }
    });
  });

  return wss;
}

function rejectAllPending(state: AppState): void {
  const pendingMaps = [
    state.pendingValidations,
    state.pendingFileSearches,
    state.pendingGitStatus,
    state.pendingGitDiff,
    state.pendingGitLog,
    state.pendingGitShow,
    state.pendingGitBranchFiles,
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
      resolveGitResponse(msg.payload, state.pendingGitStatus, (p) => ({
        files: p.files,
        branch: p.branch,
      }));
      break;
    case 'GIT_DIFF_RESPONSE':
      resolveGitResponse(msg.payload, state.pendingGitDiff, (p) => p.diff);
      break;
    case 'GIT_LOG_RESPONSE':
      resolveGitResponse(msg.payload, state.pendingGitLog, (p) => ({
        commits: p.commits,
      }));
      break;
    case 'GIT_SHOW_RESPONSE':
      resolveGitResponse(msg.payload, state.pendingGitShow, (p) => ({
        diff: p.diff,
        files: p.files,
      }));
      break;
    case 'GIT_BRANCH_FILES_RESPONSE':
      resolveGitResponse(msg.payload, state.pendingGitBranchFiles, (p) => ({
        files: p.files,
      }));
      break;
  }
}

function handleRegister(ws: WebSocket, state: AppState): void {
  if (state.daemon && state.daemon !== ws && state.daemon.readyState === ws.OPEN) {
    state.daemon.close();
  }
  state.daemon = ws;

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
  } catch {
    // DB may not be ready during tests
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

  const broadcastMsg = JSON.stringify({
    type: 'FILE_CHANGE',
    payload: { workspaceSlug, path, eventType },
  });
  for (const ws of state.fileChangeListeners) {
    if (ws.readyState === WebSocket.OPEN) ws.send(broadcastMsg);
  }
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

// ── Git response handler ────────────────────────────────────────────────────

function resolveGitResponse<T>(
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

// ── Git dispatch functions ──────────────────────────────────────────────────

function dispatchGitOp<T>(
  state: AppState,
  pendingMap: Map<string, { resolve: (result: T) => void; reject: (reason: Error) => void }>,
  messageType: string,
  payload: Record<string, unknown>,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!state.daemon || state.daemon.readyState !== state.daemon.OPEN) {
      reject(new Error('No daemon connected'));
      return;
    }

    const requestId = randomUUID();

    const timeout = setTimeout(() => {
      pendingMap.delete(requestId);
      reject(new Error(`Git operation timed out after ${timeoutMs}ms`));
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
  return dispatchGitOp(state, state.pendingGitStatus, 'GIT_STATUS_REQUEST', { repoDir });
}

export function dispatchGitDiff(
  repoDir: string,
  filePath: string,
  state: AppState,
  base?: string,
  staged?: boolean,
): Promise<string> {
  return dispatchGitOp(state, state.pendingGitDiff, 'GIT_DIFF_REQUEST', { repoDir, filePath, base, staged });
}

export function dispatchGitLog(
  repoDir: string,
  state: AppState,
  maxCount?: number,
): Promise<GitLogResult> {
  return dispatchGitOp(state, state.pendingGitLog, 'GIT_LOG_REQUEST', { repoDir, maxCount });
}

export function dispatchGitShow(
  repoDir: string,
  commitHash: string,
  state: AppState,
): Promise<GitShowResult> {
  return dispatchGitOp(state, state.pendingGitShow, 'GIT_SHOW_REQUEST', { repoDir, commitHash });
}

export function dispatchGitBranchFiles(
  repoDir: string,
  base: string,
  state: AppState,
): Promise<GitBranchFilesResult> {
  return dispatchGitOp(state, state.pendingGitBranchFiles, 'GIT_BRANCH_FILES_REQUEST', { repoDir, base });
}
