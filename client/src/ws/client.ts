import WebSocket from 'ws';
import { access } from 'node:fs/promises';
import type {
  ClientToServerMessage,
  WorkspacesSyncMessage,
  ValidatePathsRequestMessage,
  TerminalRelayCommand,
} from '@engy/common';
import type { TerminalManager } from '../terminal/manager.js';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;

interface WsClientOptions {
  serverUrl: string;
  onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  terminalManager?: TerminalManager;
}

export function computeBackoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(0, base + jitter);
}

export function deriveWsUrl(httpUrl: string): string {
  const base = httpUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/ws`;
}

export function deriveTerminalRelayUrl(httpUrl: string): string {
  const base = httpUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/ws/terminal-relay`;
}

async function validatePaths(paths: string[]): Promise<Array<{ path: string; exists: boolean }>> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        await access(p);
        return { path: p, exists: true };
      } catch {
        return { path: p, exists: false };
      }
    }),
  );
}


export class WsClient {
  private ws: WebSocket | null = null;
  private terminalWs: WebSocket | null = null;
  private attempt = 0;
  private terminalAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private readonly wsUrl: string;
  private readonly terminalRelayUrl: string;
  private readonly onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  private readonly terminalManager?: TerminalManager;

  constructor(options: WsClientOptions) {
    this.wsUrl = deriveWsUrl(options.serverUrl);
    this.terminalRelayUrl = deriveTerminalRelayUrl(options.serverUrl);
    this.onWorkspacesSync = options.onWorkspacesSync;
    this.terminalManager = options.terminalManager;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.createConnection();
    this.createTerminalConnection();
  }

  send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.terminalReconnectTimer) {
      clearTimeout(this.terminalReconnectTimer);
      this.terminalReconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.terminalWs?.close();
    this.terminalWs = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private createConnection(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.attempt = 0;
      this.send({ type: 'REGISTER', payload: {} });
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', () => {
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // close event follows, which triggers reconnect
    });
  }

  private createTerminalConnection(): void {
    if (!this.terminalManager) return;

    this.terminalWs = new WebSocket(this.terminalRelayUrl);

    this.terminalWs.on('open', () => {
      this.terminalAttempt = 0;
      // Wire terminal manager to send via terminal WS
      this.terminalManager!.setSendCallback((msg) => {
        if (this.terminalWs?.readyState === WebSocket.OPEN) {
          this.terminalWs.send(msg);
        }
      });

      // Resync: resume any sessions suspended during disconnect
      for (const session of this.terminalManager!.getAllSessions()) {
        if (session.state === 'suspended') {
          this.terminalManager!.handleReconnect(session.sessionId);
        }
      }
    });

    this.terminalWs.on('message', (data) => {
      this.handleTerminalMessage(data);
    });

    this.terminalWs.on('close', () => {
      // Suspend active sessions so output is buffered, not lost
      for (const session of this.terminalManager!.getAllSessions()) {
        if (session.state === 'active') {
          this.terminalManager!.suspend(session.sessionId);
        }
      }
      this.scheduleTerminalReconnect();
    });

    this.terminalWs.on('error', () => {
      // close event follows, which triggers reconnect
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (message.type) {
      case 'WORKSPACES_SYNC':
        this.onWorkspacesSync?.(message as WorkspacesSyncMessage);
        break;
      case 'VALIDATE_PATHS_REQUEST':
        this.handleValidatePathsRequest(message as ValidatePathsRequestMessage);
        break;
    }
  }

  private handleTerminalMessage(data: WebSocket.RawData): void {
    let msg: TerminalRelayCommand;
    try {
      msg = JSON.parse(data.toString()) as TerminalRelayCommand;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'spawn':
        this.terminalManager?.spawn({
          sessionId: msg.sessionId,
          workingDir: msg.workingDir,
          cols: msg.cols,
          rows: msg.rows,
          command: msg.command,
        });
        break;
      case 'i':
        this.terminalManager?.write(msg.sessionId, msg.d);
        break;
      case 'resize':
        this.terminalManager?.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'kill':
        this.terminalManager?.kill(msg.sessionId);
        break;
      case 'reconnect':
        this.terminalManager?.handleReconnect(msg.sessionId);
        break;
    }
  }

  private async handleValidatePathsRequest(message: ValidatePathsRequestMessage): Promise<void> {
    const results = await validatePaths(message.payload.paths);
    this.send({
      type: 'VALIDATE_PATHS_RESPONSE',
      payload: {
        requestId: message.payload.requestId,
        results,
      },
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.attempt);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, delay);
  }

  private scheduleTerminalReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.terminalAttempt);
    this.terminalAttempt++;
    this.terminalReconnectTimer = setTimeout(() => {
      this.terminalReconnectTimer = null;
      this.createTerminalConnection();
    }, delay);
  }
}
