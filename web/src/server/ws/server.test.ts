import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { createAppState, type AppState } from '../trpc/context.js';
import { attachWebSocket, dispatchValidation } from './server.js';

let openClients: WebSocket[] = [];

function startServer(state: AppState): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    attachWebSocket(server, state);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('WebSocket Server', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  describe('REGISTER', () => {
    it('should set daemon reference on REGISTER', async () => {
      const ws = await connectClient(port);
      expect(state.daemon).toBeNull();

      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });
    });

    it('should replace daemon when a second client registers', async () => {
      const ws1 = await connectClient(port);
      ws1.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const firstDaemon = state.daemon;
      const ws2 = await connectClient(port);
      ws2.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBe(firstDaemon);
      });
    });

    it('should clear daemon reference on close', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      ws.close();

      await vi.waitFor(() => {
        expect(state.daemon).toBeNull();
      });
    });
  });

  describe('FILE_CHANGE', () => {
    it('should store file change events in the ring buffer', async () => {
      const ws = await connectClient(port);

      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'my-ws', path: '/src/index.ts', eventType: 'change' },
        }),
      );

      await vi.waitFor(() => {
        const events = state.fileChanges.get('my-ws');
        expect(events).toHaveLength(1);
        expect(events![0].path).toBe('/src/index.ts');
        expect(events![0].eventType).toBe('change');
        expect(events![0].timestamp).toBeGreaterThan(0);
      });
    });

    it('should cap events at 100 per workspace', async () => {
      const ws = await connectClient(port);

      for (let i = 0; i < 110; i++) {
        ws.send(
          JSON.stringify({
            type: 'FILE_CHANGE',
            payload: { workspaceSlug: 'big-ws', path: `/file-${i}.ts`, eventType: 'add' },
          }),
        );
      }

      await vi.waitFor(() => {
        const events = state.fileChanges.get('big-ws');
        expect(events).toHaveLength(100);
        expect(events![0].path).toBe('/file-10.ts');
        expect(events![99].path).toBe('/file-109.ts');
      });
    });

    it('should keep separate ring buffers per workspace', async () => {
      const ws = await connectClient(port);

      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'ws-a', path: '/a.ts', eventType: 'add' },
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'ws-b', path: '/b.ts', eventType: 'change' },
        }),
      );

      await vi.waitFor(() => {
        expect(state.fileChanges.get('ws-a')).toHaveLength(1);
        expect(state.fileChanges.get('ws-b')).toHaveLength(1);
      });
    });
  });

  describe('VALIDATE_PATHS_RESPONSE', () => {
    it('should resolve pending validation on response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const messagePromise = waitForMessage(ws);
      const validationPromise = dispatchValidation(['/src/index.ts'], state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; paths: string[] };
      };
      expect(request.type).toBe('VALIDATE_PATHS_REQUEST');
      expect(request.payload.paths).toEqual(['/src/index.ts']);

      ws.send(
        JSON.stringify({
          type: 'VALIDATE_PATHS_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [{ path: '/src/index.ts', exists: true }],
          },
        }),
      );

      const results = await validationPromise;
      expect(results).toEqual([{ path: '/src/index.ts', exists: true }]);
    });

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchValidation(['/foo.ts'], state)).rejects.toThrow('No daemon connected');
    });

    it('should time out if no response arrives', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const validationPromise = dispatchValidation(['/slow.ts'], state, 50);

      await expect(validationPromise).rejects.toThrow('Validation timed out');
      expect(state.pendingValidations.size).toBe(0);
    });
  });

  describe('malformed messages', () => {
    it('should ignore invalid JSON', async () => {
      const ws = await connectClient(port);
      ws.send('not json at all');

      await new Promise((r) => setTimeout(r, 50));
      expect(state.daemon).toBeNull();
    });
  });
});
