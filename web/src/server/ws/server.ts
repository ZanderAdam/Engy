import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientToServerMessage, ValidatePathsRequestMessage } from '@engy/common';
import type { AppState, FileChangeEvent } from '../trpc/context.js';

const MAX_EVENTS_PER_WORKSPACE = 100;
const VALIDATION_TIMEOUT_MS = 5_000;

export function attachWebSocket(server: Server, state: AppState): void {
  const wss = new WebSocketServer({ server });

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
      }
    });
  });
}

function handleMessage(ws: WebSocket, msg: ClientToServerMessage, state: AppState): void {
  switch (msg.type) {
    case 'REGISTER':
      handleRegister(ws, state);
      break;
    case 'VALIDATE_PATHS_RESPONSE':
      handleValidatePathsResponse(msg, state);
      break;
    case 'FILE_CHANGE':
      handleFileChange(msg, state);
      break;
  }
}

function handleRegister(ws: WebSocket, state: AppState): void {
  if (state.daemon && state.daemon !== ws && state.daemon.readyState === ws.OPEN) {
    state.daemon.close();
  }
  state.daemon = ws;
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
