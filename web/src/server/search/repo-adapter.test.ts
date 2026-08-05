// @rtm-ignore — embeds [FR-…] tags as fixture strings for the traceability scanner, not real test titles
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { createAppState, type AppState } from '../trpc/context';
import { createWebSocketServer } from '../ws/server';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { makeDaemonRepoAdapter, chooseRepoAdapter } from './repo-adapter';
import { localRepoAdapter } from '../lib/requirements';

let openClients: WebSocket[] = [];

// Daemon registration sends WATCH_PATHS_SYNC, which reads the workspaces table.
// Without an isolated, migrated DB the read would hit the ambient ~/.engy data
// and break whenever the schema is ahead of that DB — so give every test here a
// fresh migrated DB (registration uses the getDb() singleton, not local state).
let dbCtx: TestContext;
beforeEach(() => {
  dbCtx = setupTestDb();
});
afterEach(() => {
  dbCtx.cleanup();
});

function startServer(state: AppState): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = createWebSocketServer(state);
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Wait for the next message of the given type and return it parsed.
 * Registration triggers an unrelated WATCH_PATHS_SYNC push that can race
 * ahead of the request under test — skip anything that doesn't match.
 */
function waitForMessage(ws: WebSocket, type: string): Promise<unknown> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type !== type) return;
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

/**
 * Register a WS as the daemon and consume the WATCH_PATHS_SYNC the server sends
 * back. Listening before sending REGISTER avoids a race where the sync either
 * got dropped (no listener yet) or polluted the next waitForMessage call.
 */
async function registerDaemon(daemon: WebSocket): Promise<void> {
  const synced = waitForMessage(daemon, 'WATCH_PATHS_SYNC');
  daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
  await synced;
}

describe('makeDaemonRepoAdapter', () => {
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

  describe('globTestFiles', () => {
    it('should send GLOB_FILES_REQUEST with test patterns and return absolute paths', async () => {
      const daemon = await connectClient(port);
      await registerDaemon(daemon);

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon, 'GLOB_FILES_REQUEST');
      const globPromise = adapter.globTestFiles('/repo/root');

      const request = (await msgPromise) as {
        type: string;
        payload: { requestId: string; repoDir: string; patterns: string[] };
      };
      expect(request.type).toBe('GLOB_FILES_REQUEST');
      expect(request.payload.repoDir).toBe('/repo/root');
      expect(request.payload.patterns).toEqual(['*.test.ts', '*.test.tsx']);

      // Daemon responds with relative paths
      daemon.send(
        JSON.stringify({
          type: 'GLOB_FILES_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            files: ['src/foo.test.ts', 'src/bar.test.tsx'],
          },
        }),
      );

      const files = await globPromise;
      // Relative paths should be made absolute against root
      expect(files).toEqual(['/repo/root/src/foo.test.ts', '/repo/root/src/bar.test.tsx']);
    });

    it('should pass through absolute paths from daemon unchanged', async () => {
      const daemon = await connectClient(port);
      await registerDaemon(daemon);

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon, 'GLOB_FILES_REQUEST');
      const globPromise = adapter.globTestFiles('/repo/root');

      const request = (await msgPromise) as {
        type: string;
        payload: { requestId: string };
      };

      daemon.send(
        JSON.stringify({
          type: 'GLOB_FILES_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            files: ['/repo/root/src/already-absolute.test.ts'],
          },
        }),
      );

      const files = await globPromise;
      expect(files).toEqual(['/repo/root/src/already-absolute.test.ts']);
    });
  });

  describe('readFile', () => {
    it('should send FILE_READ_REQUEST with dirname as repoDir and basename as filePath', async () => {
      const daemon = await connectClient(port);
      await registerDaemon(daemon);

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon, 'FILE_READ_REQUEST');
      const readPromise = adapter.readFile('/repo/root/src/foo.test.ts');

      const request = (await msgPromise) as {
        type: string;
        payload: { requestId: string; repoDir: string; filePath: string };
      };
      expect(request.type).toBe('FILE_READ_REQUEST');
      expect(request.payload.repoDir).toBe('/repo/root/src');
      expect(request.payload.filePath).toBe('foo.test.ts');

      daemon.send(
        JSON.stringify({
          type: 'FILE_READ_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            content: 'it("[FR-AUTH-001] should work", ...)',
          },
        }),
      );

      const content = await readPromise;
      expect(content).toBe('it("[FR-AUTH-001] should work", ...)');
    });
  });

  describe('exists', () => {
    it('should send VALIDATE_PATHS_REQUEST and return per-path exists boolean', async () => {
      const daemon = await connectClient(port);
      await registerDaemon(daemon);

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon, 'VALIDATE_PATHS_REQUEST');
      const existsPromise = adapter.exists('/repo/root/src/foo.ts');

      const request = (await msgPromise) as {
        type: string;
        payload: { requestId: string; paths: string[] };
      };
      expect(request.type).toBe('VALIDATE_PATHS_REQUEST');
      expect(request.payload.paths).toEqual(['/repo/root/src/foo.ts']);

      daemon.send(
        JSON.stringify({
          type: 'VALIDATE_PATHS_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [{ path: '/repo/root/src/foo.ts', exists: true }],
          },
        }),
      );

      const result = await existsPromise;
      expect(result).toBe(true);
    });

    it('should return false when the path does not exist', async () => {
      const daemon = await connectClient(port);
      await registerDaemon(daemon);

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon, 'VALIDATE_PATHS_REQUEST');
      const existsPromise = adapter.exists('/repo/root/src/missing.ts');

      const request = (await msgPromise) as {
        type: string;
        payload: { requestId: string };
      };

      daemon.send(
        JSON.stringify({
          type: 'VALIDATE_PATHS_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [{ path: '/repo/root/src/missing.ts', exists: false }],
          },
        }),
      );

      const result = await existsPromise;
      expect(result).toBe(false);
    });
  });
});

describe('chooseRepoAdapter', () => {
  it('should return localRepoAdapter when no daemon is connected', () => {
    const state = createAppState();
    const adapter = chooseRepoAdapter(state);
    expect(adapter).toBe(localRepoAdapter);
  });

  it('should return localRepoAdapter when daemon is not OPEN', () => {
    const state = createAppState();
    // Simulate a daemon that is closing (readyState !== OPEN)
    state.daemon = { readyState: WebSocket.CLOSING } as unknown as WebSocket;
    const adapter = chooseRepoAdapter(state);
    expect(adapter).toBe(localRepoAdapter);
  });

  it('should return daemon adapter when daemon is connected and OPEN', async () => {
    const openClients: WebSocket[] = [];
    const state = createAppState();
    const result = await new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer();
      const wss = createWebSocketServer(state);
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({ server, port });
      });
    });

    const daemon = new WebSocket(`ws://127.0.0.1:${result.port}/ws`);
    openClients.push(daemon);
    await new Promise<void>((resolve, reject) => {
      daemon.on('open', resolve);
      daemon.on('error', reject);
    });
    await registerDaemon(daemon);

    const adapter = chooseRepoAdapter(state);
    expect(adapter).not.toBe(localRepoAdapter);

    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    await closeServer(result.server);
  });
});
