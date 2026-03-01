import WebSocket from 'ws';
import { access } from 'node:fs/promises';
import type {
  ClientToServerMessage,
  ServerToClientMessage,
  WorkspacesSyncMessage,
  ValidatePathsRequestMessage,
} from '@engy/common';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;

export interface WsClientOptions {
  serverUrl: string;
  onWorkspacesSync: (message: WorkspacesSyncMessage) => void;
}

export function computeBackoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(0, base + jitter);
}

export function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws');
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
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private readonly wsUrl: string;
  private readonly onWorkspacesSync: (message: WorkspacesSyncMessage) => void;

  constructor(private readonly options: WsClientOptions) {
    this.wsUrl = deriveWsUrl(options.serverUrl);
    this.onWorkspacesSync = options.onWorkspacesSync;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.createConnection();
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
    this.ws?.close();
    this.ws = null;
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
      // Error will be followed by close event, which triggers reconnect
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let message: ServerToClientMessage;
    try {
      message = JSON.parse(data.toString()) as ServerToClientMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'WORKSPACES_SYNC':
        this.onWorkspacesSync(message);
        break;
      case 'VALIDATE_PATHS_REQUEST':
        this.handleValidatePathsRequest(message);
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
}
