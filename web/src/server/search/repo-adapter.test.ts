import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import type { AppState } from '../trpc/context';
import { createWebSocketServer } from '../ws/server';
import { makeDaemonRepoAdapter, chooseRepoAdapter } from './repo-adapter';
import { localRepoAdapter } from '../lib/requirements';

let openClients: WebSocket[] = [];

function startServer(state: AppState): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = createWebSocketServer(state);
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    server.listen(0, () => {
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

function makeState(): AppState {
  return {
    daemon: null,
    fileChanges: new Map(),
    pendingValidations: new Map(),
    pendingFileSearches: new Map(),
    pendingGitStatus: new Map(),
    pendingGitLog: new Map(),
    pendingGitShow: new Map(),
    pendingGitBranchFiles: new Map(),
    pendingContainerUp: new Map(),
    pendingContainerDown: new Map(),
    pendingContainerStatus: new Map(),
    pendingDevcontainerGenerate: new Map(),
    specLastChanged: new Map(),
    specDebounceTimers: new Map(),
    terminalSessions: new Map(),
    terminalSessionMeta: new Map(),
    pendingReconnects: new Map(),
    terminalDaemon: null,
    fileChangeListeners: new Set(),
    containerProgressListeners: new Map(),
    pendingExecutionStart: new Map(),
    pendingExecutionStop: new Map(),
    pendingDirList: new Map(),
    pendingFileRead: new Map(),
    pendingGlobFiles: new Map(),
    pendingFileWrite: new Map(),
    pendingRemoteFilePull: new Map(),
    pendingRemoteFilePush: new Map(),
    pendingWorktreeMerge: new Map(),
    pendingWorktreeAdd: new Map(),
    pendingWorktreeRemove: new Map(),
    pendingGitWorktreeList: new Map(),
    pendingCreateDirs: new Map(),
    daemonHomeDir: null,
  };
}

/** Wait for the next message from a WS and return it parsed. */
function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('makeDaemonRepoAdapter', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = makeState();
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
      daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (state.daemon) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon);
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
      daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (state.daemon) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon);
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
      daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (state.daemon) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon);
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
      daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (state.daemon) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon);
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
      daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (state.daemon) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      const adapter = makeDaemonRepoAdapter(state);
      const msgPromise = waitForMessage(daemon);
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
    const state = makeState();
    const adapter = chooseRepoAdapter(state);
    expect(adapter).toBe(localRepoAdapter);
  });

  it('should return localRepoAdapter when daemon is not OPEN', () => {
    const state = makeState();
    // Simulate a daemon that is closing (readyState !== OPEN)
    state.daemon = { readyState: WebSocket.CLOSING } as unknown as WebSocket;
    const adapter = chooseRepoAdapter(state);
    expect(adapter).toBe(localRepoAdapter);
  });

  it('should return daemon adapter when daemon is connected and OPEN', async () => {
    const openClients: WebSocket[] = [];
    const state = makeState();
    const result = await new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer();
      const wss = createWebSocketServer(state);
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
      server.listen(0, () => {
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
    daemon.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (state.daemon) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });

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
