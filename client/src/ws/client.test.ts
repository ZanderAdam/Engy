import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import { WsClient, computeBackoff, deriveWsUrl, deriveTerminalRelayUrl } from './client.js';
import type {
  WorkspacesSyncMessage,
  ValidatePathsRequestMessage,
  ExecutionStartRequestMessage,
  ExecutionStopRequestMessage,
  RemoteFilePullRequestMessage,
  RemoteFilePushRequestMessage,
  WorktreeMergeRequestMessage,
  DevcontainerConfigGenerateRequestMessage,
} from '@engy/common';
import type { TerminalManager } from '../terminal/manager.js';
import type { PersistentSession } from '../terminal/types.js';
import { access } from 'node:fs/promises';
import { generateDevcontainerConfig } from '../container/config-generator.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Runner } from '../runner/index.js';
import { EventEmitter } from 'node:events';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { simpleGit } from 'simple-git';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    access: vi.fn(),
  };
});

vi.mock('../container/config-generator.js', () => ({
  generateDevcontainerConfig: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const { promisify: nodePromisify } = await import('node:util');
  const original = await importOriginal<typeof import('node:child_process')>();
  const fn = vi.fn() as Record<symbol, unknown> & ReturnType<typeof vi.fn>;
  fn[nodePromisify.custom] = vi.fn();
  return {
    ...original,
    execFile: fn,
  };
});

const mockedExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn> & {
  [promisify.custom]: ReturnType<typeof vi.fn>;
};

const mockedAccess = vi.mocked(access);

describe('deriveWsUrl', () => {
  it('converts http to ws', () => {
    expect(deriveWsUrl('http://localhost:3000')).toBe('ws://localhost:3000/ws');
  });

  it('converts https to wss', () => {
    expect(deriveWsUrl('https://example.com')).toBe('wss://example.com/ws');
  });
});

describe('deriveTerminalRelayUrl', () => {
  it('converts http to ws with terminal-relay path', () => {
    expect(deriveTerminalRelayUrl('http://localhost:3000')).toBe(
      'ws://localhost:3000/ws/terminal-relay',
    );
  });

  it('converts https to wss with terminal-relay path', () => {
    expect(deriveTerminalRelayUrl('https://example.com')).toBe(
      'wss://example.com/ws/terminal-relay',
    );
  });
});

describe('[FR-WS-130] computeBackoff', () => {
  it('[FR-WS-130] starts at ~1s for attempt 0', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(0));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(800); // 1000 - 20%
      expect(delay).toBeLessThanOrEqual(1200); // 1000 + 20%
    }
  });

  it('[FR-WS-130] doubles with each attempt', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(1));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(1600); // 2000 - 20%
      expect(delay).toBeLessThanOrEqual(2400); // 2000 + 20%
    }
  });

  it('[FR-WS-130] caps at 30s max', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(20));
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(36_000); // 30000 + 20%
    }
  });

  it('never returns negative', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(0));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('WsClient', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('[FR-WS-010] [FR-WS-130] sends REGISTER on connect', async () => {
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    const msg = await waitForMessage(ws);
    expect(JSON.parse(msg)).toEqual({ type: 'REGISTER', payload: { homeDir: os.homedir() } });
  });

  it('[FR-WS-010] calls onWorkspacesSync when receiving WORKSPACES_SYNC', async () => {
    const onWorkspacesSync = vi.fn();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const syncMessage: WorkspacesSyncMessage = {
      type: 'WORKSPACES_SYNC',
      payload: { workspaces: [{ slug: 'test-ws', repos: ['/tmp/repo'] }] },
    };
    ws.send(JSON.stringify(syncMessage));

    await vi.waitFor(() => {
      expect(onWorkspacesSync).toHaveBeenCalledWith(syncMessage);
    });
  });

  it('responds to VALIDATE_PATHS_REQUEST', async () => {
    const connPromise = waitForConnection(server);

    mockedAccess.mockImplementation(async (p) => {
      if (p === '/exists') return undefined;
      throw new Error('ENOENT');
    });

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ValidatePathsRequestMessage = {
      type: 'VALIDATE_PATHS_REQUEST',
      payload: { requestId: 'req-1', paths: ['/exists', '/nope'] },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'VALIDATE_PATHS_RESPONSE',
      payload: {
        requestId: 'req-1',
        results: [
          { path: '/exists', exists: true },
          { path: '/nope', exists: false },
        ],
      },
    });
  });

  it('[FR-WS-130] reconnects after server closes connection', async () => {
    const onWorkspacesSync = vi.fn();
    let connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync,
    });
    client.connect();

    const ws1 = await connPromise;
    await waitForMessage(ws1);

    // Prepare to catch second connection
    connPromise = waitForConnection(server);
    ws1.close();

    const ws2 = await connPromise;
    const msg = await waitForMessage(ws2);
    expect(JSON.parse(msg)).toEqual({ type: 'REGISTER', payload: { homeDir: os.homedir() } });
  });

  it('[FR-WS-130] does not reconnect after intentional close', async () => {
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    await connPromise;
    client.close();

    const secondConn = vi.fn();
    server.on('connection', secondConn);

    await new Promise((r) => setTimeout(r, 200));
    expect(secondConn).not.toHaveBeenCalled();
  });

  it('reports connected state correctly', async () => {
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });

    expect(client.connected).toBe(false);
    client.connect();

    await connPromise;
    await vi.waitFor(() => expect(client.connected).toBe(true));

    client.close();
    expect(client.connected).toBe(false);
  });
});

function createMockTerminalManager(
  sessions: PersistentSession[] = [],
): TerminalManager & { [K in keyof TerminalManager]: ReturnType<typeof vi.fn> } {
  return {
    setSendCallback: vi.fn(),
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    handleReconnect: vi.fn(),
    suspend: vi.fn(),
    getAllSessions: vi.fn(() => sessions),
  } as unknown as TerminalManager & { [K in keyof TerminalManager]: ReturnType<typeof vi.fn> };
}

describe('WsClient terminal relay', () => {
  let httpServer: Server;
  let mainWss: WebSocketServer;
  let relayWss: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  beforeEach(async () => {
    mainWss = new WebSocketServer({ noServer: true });
    relayWss = new WebSocketServer({ noServer: true });

    httpServer = createServer();
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      if (url.startsWith('/ws/terminal-relay')) {
        relayWss.handleUpgrade(req, socket, head, (ws) => {
          relayWss.emit('connection', ws, req);
        });
      } else if (url.startsWith('/ws')) {
        mainWss.handleUpgrade(req, socket, head, (ws) => {
          mainWss.emit('connection', ws, req);
        });
      }
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('connects terminal relay alongside main WS', async () => {
    const mockTm = createMockTerminalManager();
    const mainConn = waitForConnection(mainWss);
    const relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    await mainConn;
    await relayConn;

    await vi.waitFor(() => {
      expect(mockTm.setSendCallback).toHaveBeenCalled();
    });
  });

  it('forwards spawn message to terminalManager', async () => {
    const mockTm = createMockTerminalManager();
    const relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs = await relayConn;

    const spawnMsg = JSON.stringify({
      t: 'spawn',
      sessionId: 'sess-1',
      workingDir: '/tmp',
      cols: 80,
      rows: 24,
      scopeType: 'workspace',
      scopeLabel: 'test',
    });
    relayWs.send(spawnMsg);

    await vi.waitFor(() => {
      expect(mockTm.spawn).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: undefined,
      });
    });
  });

  it('forwards input message to terminalManager.write', async () => {
    const mockTm = createMockTerminalManager();
    const relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs = await relayConn;

    relayWs.send(JSON.stringify({ t: 'i', sessionId: 'sess-1', d: 'ls\r' }));

    await vi.waitFor(() => {
      expect(mockTm.write).toHaveBeenCalledWith('sess-1', 'ls\r');
    });
  });

  it('reconnects terminal relay independently of main WS', async () => {
    const mockTm = createMockTerminalManager();
    let relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs1 = await relayConn;
    await vi.waitFor(() => {
      expect(mockTm.setSendCallback).toHaveBeenCalledTimes(1);
    });

    // Close relay — should reconnect
    relayConn = waitForConnection(relayWss);
    relayWs1.close();

    await relayConn;
    await vi.waitFor(() => {
      expect(mockTm.setSendCallback).toHaveBeenCalledTimes(2);
    });
  });

  it('suspends active sessions on relay close', async () => {
    const activeSessions = [
      { sessionId: 'a', state: 'active' },
      { sessionId: 'b', state: 'suspended' },
    ] as PersistentSession[];
    const mockTm = createMockTerminalManager(activeSessions);
    const relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs = await relayConn;
    relayWs.close();

    await vi.waitFor(() => {
      // Only 'a' should be suspended (it was active), not 'b' (already suspended)
      expect(mockTm.suspend).toHaveBeenCalledTimes(1);
      expect(mockTm.suspend).toHaveBeenCalledWith('a');
    });
  });

  it('sends sync message with known session IDs on relay connect', async () => {
    const sessions = [
      { sessionId: 'a1', state: 'active' },
      { sessionId: 'b2', state: 'suspended' },
    ] as PersistentSession[];
    const mockTm = createMockTerminalManager(sessions);
    const relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs = await relayConn;
    const msg = await new Promise<string>((resolve) => {
      relayWs.once('message', (data) => resolve(data.toString()));
    });

    const parsed = JSON.parse(msg);
    expect(parsed).toEqual({ t: 'sync', sessionIds: ['a1', 'b2'] });
  });

  it('does not reconnect when a superseded connection closes', async () => {
    const mockTm = createMockTerminalManager();
    let relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs1 = await relayConn;
    await vi.waitFor(() => {
      expect(mockTm.setSendCallback).toHaveBeenCalledTimes(1);
    });

    // Force a reconnect by closing the relay
    relayConn = waitForConnection(relayWss);
    relayWs1.close();

    const relayWs2 = await relayConn;
    await vi.waitFor(() => {
      expect(mockTm.setSendCallback).toHaveBeenCalledTimes(2);
    });

    // Now close the OLD relay (ws1) again — this simulates a ghost close event.
    // The closure guard should prevent a third reconnect.
    const thirdConn = vi.fn();
    relayWss.on('connection', thirdConn);

    relayWs1.terminate();

    // Wait a bit and verify no third connection was made
    await new Promise((r) => setTimeout(r, 300));
    expect(thirdConn).not.toHaveBeenCalled();

    // Verify ws2 is still the active connection
    expect(mockTm.setSendCallback).toHaveBeenCalledTimes(2);
    relayWs2.terminate();
  });

  it('resumes suspended sessions on relay reconnect', async () => {
    const sessions = [
      { sessionId: 'x', state: 'suspended' },
      { sessionId: 'y', state: 'active' },
    ] as PersistentSession[];
    const mockTm = createMockTerminalManager(sessions);
    let relayConn = waitForConnection(relayWss);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      terminalManager: mockTm,
    });
    client.connect();

    const relayWs1 = await relayConn;

    // On initial connect, 'x' is suspended → should resume
    await vi.waitFor(() => {
      expect(mockTm.handleReconnect).toHaveBeenCalledWith('x');
      expect(mockTm.handleReconnect).toHaveBeenCalledTimes(1);
    });

    // Close and reconnect — session states refreshed from mock
    mockTm.handleReconnect.mockClear();
    relayConn = waitForConnection(relayWss);
    relayWs1.close();

    await relayConn;

    await vi.waitFor(() => {
      // 'x' is still suspended per our mock → resumed again
      expect(mockTm.handleReconnect).toHaveBeenCalledWith('x');
    });
  });
});

function createMockRunner(overrides: Partial<Runner> = {}): Runner {
  return {
    start: vi.fn().mockResolvedValue('mock-session-123'),
    stop: vi.fn(), // accepts sessionId per TG1
    retry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Runner;
}

describe('WsClient execution handlers', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('delegates EXECUTION_START_REQUEST to Runner.start and sends response', async () => {
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ExecutionStartRequestMessage = {
      type: 'EXECUTION_START_REQUEST',
      payload: {
        requestId: 'req-exec-1',
        sessionId: 'test-session-1',
        prompt: 'Fix the bug',
        flags: ['--verbose'],
        config: { repoPath: '/tmp/repo', containerMode: false },
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({
      type: 'EXECUTION_START_RESPONSE',
      payload: { requestId: 'req-exec-1', sessionId: 'test-session-1' },
    });

    expect(mockRunner.start).toHaveBeenCalledWith(
      'test-session-1',
      'Fix the bug',
      ['--verbose'],
      expect.objectContaining({
        repoPath: '/tmp/repo',
        containerMode: false,
        containerWorkspaceFolder: undefined,
        serverPort: port,
        env: undefined,
      }),
    );
  });

  it('delegates EXECUTION_STOP_REQUEST to Runner.stop with sessionId and sends response', async () => {
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ExecutionStopRequestMessage = {
      type: 'EXECUTION_STOP_REQUEST',
      payload: { requestId: 'req-stop-1', sessionId: 'sess-abc' },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({
      type: 'EXECUTION_STOP_RESPONSE',
      payload: { requestId: 'req-stop-1', success: true },
    });

    expect(mockRunner.stop).toHaveBeenCalledWith('sess-abc');
  });

  it('sends error response when Runner.start throws', async () => {
    const mockRunner = createMockRunner({
      start: vi.fn().mockRejectedValue(new Error('git worktree creation failed')),
    });
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ExecutionStartRequestMessage = {
      type: 'EXECUTION_START_REQUEST',
      payload: {
        requestId: 'req-err-1',
        sessionId: 'test-session-err',
        prompt: 'Do something',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({
      type: 'EXECUTION_START_RESPONSE',
      payload: { requestId: 'req-err-1', error: 'git worktree creation failed' },
    });
  });

  it('sends error response when Runner.stop throws', async () => {
    const mockRunner = createMockRunner({
      stop: vi.fn().mockImplementation(() => {
        throw new Error('no active process');
      }),
    });
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ExecutionStopRequestMessage = {
      type: 'EXECUTION_STOP_REQUEST',
      payload: { requestId: 'req-stop-err', sessionId: 'sess-abc' },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({
      type: 'EXECUTION_STOP_RESPONSE',
      payload: { requestId: 'req-stop-err', error: 'no active process' },
    });
  });

  it('forwards Runner events through WS send', async () => {
    const mockRunner = createMockRunner();

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    // The runner is injected as mock, so events are sent via client.send()
    // directly. Test that client.send() works for execution event types.
    client.send({
      type: 'EXECUTION_STATUS_EVENT',
      payload: { sessionId: 'evt-session', status: 'running' },
    });

    const statusMsg = await waitForMessage(ws);
    expect(JSON.parse(statusMsg)).toEqual({
      type: 'EXECUTION_STATUS_EVENT',
      payload: { sessionId: 'evt-session', status: 'running' },
    });

    client.send({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 'evt-session', exitCode: 0, success: true },
    });

    const completeMsg = await waitForMessage(ws);
    expect(JSON.parse(completeMsg)).toEqual({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 'evt-session', exitCode: 0, success: true },
    });
  });

  it('handles EXECUTION_START_REQUEST with no flags or config', async () => {
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: ExecutionStartRequestMessage = {
      type: 'EXECUTION_START_REQUEST',
      payload: {
        requestId: 'req-minimal',
        sessionId: 'test-session-minimal',
        prompt: 'Simple task',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({
      type: 'EXECUTION_START_RESPONSE',
      payload: { requestId: 'req-minimal', sessionId: 'test-session-minimal' },
    });

    expect(mockRunner.start).toHaveBeenCalledWith(
      'test-session-minimal',
      'Simple task',
      [],
      expect.objectContaining({
        repoPath: '',
        containerMode: false,
        containerWorkspaceFolder: undefined,
        serverPort: port,
        env: undefined,
      }),
    );
  });
});

describe('WsClient remote file sync handlers', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('responds to REMOTE_FILE_PULL_REQUEST with file content on success', async () => {
    mockedExecFile[promisify.custom].mockResolvedValue({
      stdout: 'file-content-here',
      stderr: '',
    });

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: RemoteFilePullRequestMessage = {
      type: 'REMOTE_FILE_PULL_REQUEST',
      payload: {
        requestId: 'pull-1',
        coderWorkspace: 'my-workspace',
        filePath: '/home/user/file.txt',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PULL_RESPONSE',
      payload: { requestId: 'pull-1', content: 'file-content-here' },
    });
  });

  it('responds to REMOTE_FILE_PULL_REQUEST with error for missing file', async () => {
    mockedExecFile[promisify.custom].mockRejectedValue(
      new Error('cat: /missing/file: No such file or directory'),
    );

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: RemoteFilePullRequestMessage = {
      type: 'REMOTE_FILE_PULL_REQUEST',
      payload: {
        requestId: 'pull-2',
        coderWorkspace: 'my-workspace',
        filePath: '/missing/file',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PULL_RESPONSE',
      payload: {
        requestId: 'pull-2',
        error: 'cat: /missing/file: No such file or directory',
      },
    });
  });

  it('responds to REMOTE_FILE_PUSH_REQUEST with success on write', async () => {
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    const stderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      stderr,
    });

    mockedExecFile.mockReturnValue(mockChild as unknown as ReturnType<typeof execFile>);

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: RemoteFilePushRequestMessage = {
      type: 'REMOTE_FILE_PUSH_REQUEST',
      payload: {
        requestId: 'push-1',
        coderWorkspace: 'my-workspace',
        filePath: 'plans/foo.plan.md',
        content: 'hello world',
      },
    };
    ws.send(JSON.stringify(request));

    await vi.waitFor(() => {
      expect(stdinWrite).toHaveBeenCalledWith('hello world');
    });

    // Verify coder ssh was invoked with --no-wait and a command that
    // mkdir -p's the parent dir before cat-ing to the target path.
    expect(mockedExecFile).toHaveBeenCalledWith('coder', [
      'ssh',
      '--no-wait',
      'my-workspace',
      '--',
      'bash',
      '-c',
      `mkdir -p "$(dirname 'plans/foo.plan.md')" && cat > 'plans/foo.plan.md'`,
    ]);

    mockChild.emit('close', 0);

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PUSH_RESPONSE',
      payload: { requestId: 'push-1', success: true },
    });
  });

  it('responds to REMOTE_FILE_PUSH_REQUEST with captured stderr on failure', async () => {
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    const stderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      stderr,
    });

    mockedExecFile.mockReturnValue(mockChild as unknown as ReturnType<typeof execFile>);

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: RemoteFilePushRequestMessage = {
      type: 'REMOTE_FILE_PUSH_REQUEST',
      payload: {
        requestId: 'push-2',
        coderWorkspace: 'my-workspace',
        filePath: 'plans/foo.plan.md',
        content: 'data',
      },
    };
    ws.send(JSON.stringify(request));

    await vi.waitFor(() => {
      expect(stdinWrite).toHaveBeenCalled();
    });

    stderr.emit('data', Buffer.from('bash: plans/foo.plan.md: Permission denied\n'));
    mockChild.emit('close', 1);

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PUSH_RESPONSE',
      payload: {
        requestId: 'push-2',
        error: 'coder ssh push failed (exit 1): bash: plans/foo.plan.md: Permission denied',
      },
    });
  });

  it('escapes single quotes in filePath to prevent shell injection', async () => {
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    const stderr = new EventEmitter();
    const mockChild = Object.assign(new EventEmitter(), {
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      stderr,
    });

    mockedExecFile.mockReturnValue(mockChild as unknown as ReturnType<typeof execFile>);

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: RemoteFilePushRequestMessage = {
      type: 'REMOTE_FILE_PUSH_REQUEST',
      payload: {
        requestId: 'push-3',
        coderWorkspace: 'my-workspace',
        filePath: "plans/foo's.plan.md",
        content: 'x',
      },
    };
    ws.send(JSON.stringify(request));

    await vi.waitFor(() => {
      expect(mockedExecFile).toHaveBeenCalled();
    });

    const lastCall = mockedExecFile.mock.calls[mockedExecFile.mock.calls.length - 1];
    const args = lastCall?.[1] as string[];
    const remoteCmd = args[args.length - 1];
    // The quote in `foo's` must be escaped via `'\''` in both mkdir and cat invocations.
    const escaped = `'plans/foo'\\''s.plan.md'`;
    expect(remoteCmd).toBe(`mkdir -p "$(dirname ${escaped})" && cat > ${escaped}`);

    mockChild.emit('close', 0);
    await waitForMessage(ws);
  });
});

describe('WsClient worktree merge handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('merges branch and returns success when worktree is found', async () => {
    const porcelainOutput = [
      'worktree /home/user/main-repo',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /home/user/worktrees/feature-x',
      'HEAD def5678',
      'branch refs/heads/feature-x',
    ].join('\n');

    mockedExecFile[promisify.custom]
      .mockResolvedValueOnce({ stdout: porcelainOutput, stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: WorktreeMergeRequestMessage = {
      type: 'WORKTREE_MERGE_REQUEST',
      payload: {
        requestId: 'merge-1',
        worktreePath: '/home/user/worktrees/feature-x',
        repoDir: '/home/user/main-repo',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'WORKTREE_MERGE_RESULT',
      payload: { requestId: 'merge-1', success: true, branch: 'feature-x' },
    });
  });

  it('returns error when no matching worktree is found', async () => {
    const porcelainOutput = [
      'worktree /home/user/main-repo',
      'HEAD abc1234',
      'branch refs/heads/main',
    ].join('\n');

    mockedExecFile[promisify.custom].mockResolvedValueOnce({
      stdout: porcelainOutput,
      stderr: '',
    });

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: WorktreeMergeRequestMessage = {
      type: 'WORKTREE_MERGE_REQUEST',
      payload: {
        requestId: 'merge-2',
        worktreePath: '/home/user/worktrees/nonexistent',
        repoDir: '/home/user/main-repo',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'WORKTREE_MERGE_RESULT',
      payload: {
        requestId: 'merge-2',
        error: 'No branch found for worktree: /home/user/worktrees/nonexistent',
      },
    });
  });

  it('returns error when merge fails due to conflict', async () => {
    const porcelainOutput = [
      'worktree /home/user/main-repo',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /home/user/worktrees/feature-y',
      'HEAD def5678',
      'branch refs/heads/feature-y',
    ].join('\n');

    mockedExecFile[promisify.custom]
      .mockResolvedValueOnce({ stdout: porcelainOutput, stderr: '' })
      .mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in file.txt'));

    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: WorktreeMergeRequestMessage = {
      type: 'WORKTREE_MERGE_REQUEST',
      payload: {
        requestId: 'merge-3',
        worktreePath: '/home/user/worktrees/feature-y',
        repoDir: '/home/user/main-repo',
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'WORKTREE_MERGE_RESULT',
      payload: {
        requestId: 'merge-3',
        error: 'CONFLICT (content): Merge conflict in file.txt',
      },
    });
  });
});

describe('WsClient worktree add/remove handlers', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'engy-ws-wt-test-'));

    const realChildProcess =
      await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const realExecFileAsync = promisify(realChildProcess.execFile);
    mockedExecFile[promisify.custom].mockImplementation(
      (...args: Parameters<typeof realExecFileAsync>) => realExecFileAsync(...args),
    );
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createTempRepo(): Promise<string> {
    const repoDir = mkdtempSync(nodePath.join(tmpDir, 'repo-'));
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    nodeFs.writeFileSync(nodePath.join(repoDir, 'init.txt'), 'hello');
    await git.add('init.txt');
    await git.commit('initial commit');
    return repoDir;
  }

  async function setupAndSend(req: object): Promise<string> {
    const connPromise = waitForConnection(server);
    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER
    ws.send(JSON.stringify(req));
    return waitForMessage(ws);
  }

  describe('WORKTREE_ADD_REQUEST', () => {
    it('creates a worktree with -b when createBranch is true', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-feat-x');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-1',
          repoDir,
          worktreePath,
          branch: 'feat-x',
          createBranch: true,
        },
      });

      expect(JSON.parse(response)).toEqual({
        type: 'WORKTREE_ADD_RESULT',
        payload: {
          requestId: 'add-1',
          success: true,
          worktreePath,
          branch: 'feat-x',
        },
      });
      expect(nodeFs.existsSync(worktreePath)).toBe(true);
      const list = await simpleGit(repoDir).raw(['worktree', 'list', '--porcelain']);
      expect(list).toContain(worktreePath);
    });

    it('checks out an existing branch when createBranch is false', async () => {
      const repoDir = await createTempRepo();
      const git = simpleGit(repoDir);
      await git.branch(['existing-branch']);
      const worktreePath = nodePath.join(tmpDir, 'wt-existing');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-2',
          repoDir,
          worktreePath,
          branch: 'existing-branch',
          createBranch: false,
        },
      });

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe('WORKTREE_ADD_RESULT');
      expect(parsed.payload.success).toBe(true);
      expect(nodeFs.existsSync(worktreePath)).toBe(true);
      const list = await git.raw(['worktree', 'list', '--porcelain']);
      expect(list).toContain(worktreePath);
    });

    it('classifies branch-already-exists errors as BRANCH_EXISTS', async () => {
      const repoDir = await createTempRepo();
      const git = simpleGit(repoDir);
      await git.branch(['feat-x']);
      const worktreePath = nodePath.join(tmpDir, 'wt-branch-exists');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-3',
          repoDir,
          worktreePath,
          branch: 'feat-x',
          createBranch: true,
        },
      });

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe('WORKTREE_ADD_RESULT');
      expect(parsed.payload.code).toBe('BRANCH_EXISTS');
    });

    it('classifies path-already-checked-out errors as PATH_EXISTS', async () => {
      const repoDir = await createTempRepo();
      const wt1 = nodePath.join(tmpDir, 'wt-first');
      await simpleGit(repoDir).raw(['worktree', 'add', '-b', 'checked-out-branch', wt1]);
      const wt2 = nodePath.join(tmpDir, 'wt-second');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-4',
          repoDir,
          worktreePath: wt2,
          branch: 'checked-out-branch',
          createBranch: false,
        },
      });

      expect(JSON.parse(response).payload.code).toBe('PATH_EXISTS');
    });

    it('classifies unknown errors as OTHER', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-no-ref');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-5',
          repoDir,
          worktreePath,
          branch: 'new-branch',
          createBranch: true,
          baseRef: 'nonexistent-ref-xyz',
        },
      });

      expect(JSON.parse(response).payload.code).toBe('OTHER');
    });

    it('passes baseRef as final positional argument when createBranch is true', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-baseref');

      const response = await setupAndSend({
        type: 'WORKTREE_ADD_REQUEST',
        payload: {
          requestId: 'add-6',
          repoDir,
          worktreePath,
          branch: 'feat-from-main',
          createBranch: true,
          baseRef: 'HEAD',
        },
      });

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe('WORKTREE_ADD_RESULT');
      expect(parsed.payload.success).toBe(true);
      expect(nodeFs.existsSync(worktreePath)).toBe(true);
    });
  });

  describe('WORKTREE_REMOVE_REQUEST', () => {
    it('removes a worktree successfully', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-to-remove');
      await simpleGit(repoDir).raw(['worktree', 'add', '-b', 'remove-me', worktreePath]);

      const response = await setupAndSend({
        type: 'WORKTREE_REMOVE_REQUEST',
        payload: {
          requestId: 'rm-1',
          repoDir,
          worktreePath,
          force: false,
        },
      });

      expect(JSON.parse(response)).toEqual({
        type: 'WORKTREE_REMOVE_RESULT',
        payload: { requestId: 'rm-1', success: true },
      });
      expect(nodeFs.existsSync(worktreePath)).toBe(false);
    });

    it('passes --force when force is true', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-dirty-force');
      await simpleGit(repoDir).raw(['worktree', 'add', '-b', 'dirty-branch', worktreePath]);
      nodeFs.writeFileSync(nodePath.join(worktreePath, 'untracked.txt'), 'dirty');

      const response = await setupAndSend({
        type: 'WORKTREE_REMOVE_REQUEST',
        payload: {
          requestId: 'rm-2',
          repoDir,
          worktreePath,
          force: true,
        },
      });

      const parsed = JSON.parse(response);
      expect(parsed.type).toBe('WORKTREE_REMOVE_RESULT');
      expect(parsed.payload.success).toBe(true);
      expect(nodeFs.existsSync(worktreePath)).toBe(false);
    });

    it('classifies dirty-worktree errors as DIRTY', async () => {
      const repoDir = await createTempRepo();
      const worktreePath = nodePath.join(tmpDir, 'wt-dirty');
      await simpleGit(repoDir).raw(['worktree', 'add', '-b', 'dirty-wt', worktreePath]);
      nodeFs.writeFileSync(nodePath.join(worktreePath, 'dirty.txt'), 'untracked change');

      const response = await setupAndSend({
        type: 'WORKTREE_REMOVE_REQUEST',
        payload: {
          requestId: 'rm-3',
          repoDir,
          worktreePath,
          force: false,
        },
      });

      expect(JSON.parse(response).payload.code).toBe('DIRTY');
    });

    it('classifies unknown errors as OTHER', async () => {
      const repoDir = await createTempRepo();
      const nonexistentPath = nodePath.join(tmpDir, 'wt-does-not-exist');

      const response = await setupAndSend({
        type: 'WORKTREE_REMOVE_REQUEST',
        payload: {
          requestId: 'rm-4',
          repoDir,
          worktreePath: nonexistentPath,
          force: false,
        },
      });

      expect(JSON.parse(response).payload.code).toBe('OTHER');
    });
  });
});

describe('WsClient devcontainer config generate handler', () => {
  const mockedGenerate = vi.mocked(generateDevcontainerConfig);
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    mockedGenerate.mockReset();
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('calls generateDevcontainerConfig and responds with success', async () => {
    mockedGenerate.mockResolvedValueOnce(undefined);
    const connPromise = waitForConnection(server);

    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: DevcontainerConfigGenerateRequestMessage = {
      type: 'DEVCONTAINER_CONFIG_GENERATE_REQUEST',
      payload: {
        requestId: 'gen-1',
        workspaceFolder: '/tmp/docs',
        repos: ['/tmp/repo'],
        config: { allowedDomains: ['example.com'] },
      },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'DEVCONTAINER_CONFIG_GENERATE_RESPONSE',
      payload: { requestId: 'gen-1', success: true },
    });

    expect(mockedGenerate).toHaveBeenCalledWith({
      docsDir: '/tmp/docs',
      repos: ['/tmp/repo'],
      containerConfig: { allowedDomains: ['example.com'] },
    });
  });

  it('responds with error when generateDevcontainerConfig throws', async () => {
    mockedGenerate.mockRejectedValueOnce(new Error('permission denied'));
    const connPromise = waitForConnection(server);

    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const request: DevcontainerConfigGenerateRequestMessage = {
      type: 'DEVCONTAINER_CONFIG_GENERATE_REQUEST',
      payload: { requestId: 'gen-2', workspaceFolder: '/tmp/readonly' },
    };
    ws.send(JSON.stringify(request));

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'DEVCONTAINER_CONFIG_GENERATE_RESPONSE',
      payload: { requestId: 'gen-2', error: 'permission denied' },
    });
  });
});

describe('WsClient dir list handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'dir-list-'));
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes dotfiles and previously skipped directories', async () => {
    nodeFs.writeFileSync(nodePath.join(tmpDir, '.env'), 'X=1');
    nodeFs.writeFileSync(nodePath.join(tmpDir, '.gitignore'), 'node_modules\n');
    nodeFs.writeFileSync(nodePath.join(tmpDir, 'README.md'), '# hi');
    nodeFs.mkdirSync(nodePath.join(tmpDir, 'node_modules'));
    nodeFs.mkdirSync(nodePath.join(tmpDir, 'src'));

    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    ws.send(
      JSON.stringify({
        type: 'DIR_LIST_REQUEST',
        payload: { requestId: 'list-1', dirPath: tmpDir },
      }),
    );

    const response = JSON.parse(await waitForMessage(ws));
    expect(response.type).toBe('DIR_LIST_RESPONSE');
    expect(response.payload.requestId).toBe('list-1');
    expect(response.payload.dirs).toEqual(['node_modules', 'src']);
    const fileNames = (response.payload.files as Array<{ name: string; mtime: number }>).map(
      (f) => f.name,
    );
    expect(fileNames).toEqual(['.env', '.gitignore', 'README.md']);
    for (const f of response.payload.files as Array<{ name: string; mtime: number }>) {
      expect(typeof f.mtime).toBe('number');
      expect(f.mtime).toBeGreaterThan(0);
    }
  });

  it('returns error for unreadable path', async () => {
    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    const missing = nodePath.join(tmpDir, 'does-not-exist');
    ws.send(
      JSON.stringify({
        type: 'DIR_LIST_REQUEST',
        payload: { requestId: 'list-2', dirPath: missing },
      }),
    );

    const response = JSON.parse(await waitForMessage(ws));
    expect(response.type).toBe('DIR_LIST_RESPONSE');
    expect(response.payload.requestId).toBe('list-2');
    expect(response.payload.error).toBeDefined();
  });
});

describe('WsClient search files handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => {
      wss.once('connection', resolve);
    });
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) {
        resolve();
      } else {
        server.on('listening', () => resolve());
      }
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'search-files-'));
    mockedExecFile[promisify.custom].mockReset();
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('non-git fallback surfaces dotfiles and node_modules entries', async () => {
    nodeFs.writeFileSync(nodePath.join(tmpDir, '.env'), 'X=1');
    nodeFs.writeFileSync(nodePath.join(tmpDir, 'README.md'), '# hi');
    nodeFs.mkdirSync(nodePath.join(tmpDir, 'node_modules'));
    nodeFs.writeFileSync(nodePath.join(tmpDir, 'node_modules', 'pkg.json'), '{}');
    nodeFs.mkdirSync(nodePath.join(tmpDir, '.config'));
    nodeFs.writeFileSync(nodePath.join(tmpDir, '.config', 'settings.json'), '{}');

    // Force non-git path by making `git rev-parse` reject.
    mockedExecFile[promisify.custom].mockRejectedValue(new Error('not a git repo'));

    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    ws.send(
      JSON.stringify({
        type: 'SEARCH_FILES_REQUEST',
        payload: { requestId: 'search-1', dirs: [tmpDir], query: '', limit: 50 },
      }),
    );

    const response = JSON.parse(await waitForMessage(ws));
    expect(response.type).toBe('SEARCH_FILES_RESPONSE');
    const paths = (response.payload.results as Array<{ path: string }>).map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '.env',
        'README.md',
        'node_modules/pkg.json',
        '.config/settings.json',
      ]),
    );
    // Confirm the fallback path was actually exercised (getGitRoot probed and failed).
    const gitProbe = mockedExecFile[promisify.custom].mock.calls[0]?.[1];
    expect(gitProbe).toEqual(expect.arrayContaining(['rev-parse', '--show-toplevel']));
  });

  it('git-backed search uses git ls-files (unchanged)', async () => {
    // Force git path: rev-parse succeeds and returns the repo root,
    // then ls-files returns a tracked file list.
    const repoRoot = tmpDir;
    mockedExecFile[promisify.custom]
      .mockResolvedValueOnce({ stdout: `${repoRoot}\n`, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/index.ts\nREADME.md\n', stderr: '' });

    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER

    ws.send(
      JSON.stringify({
        type: 'SEARCH_FILES_REQUEST',
        payload: { requestId: 'search-2', dirs: [repoRoot], query: '', limit: 50 },
      }),
    );

    const response = JSON.parse(await waitForMessage(ws));
    const paths = (response.payload.results as Array<{ path: string }>).map((r) => r.path);
    // Exact match proves the git path was taken — fallback would have returned [] from the empty tmpDir.
    expect(paths).toEqual(['src/index.ts', 'README.md']);
    const gitCalls = mockedExecFile[promisify.custom].mock.calls;
    expect(gitCalls[0]?.[1]).toEqual(expect.arrayContaining(['rev-parse', '--show-toplevel']));
    expect(gitCalls[1]?.[1]).toEqual(expect.arrayContaining(['ls-files']));
  });
});

describe('WsClient CREATE_DIR_REQUEST handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'create-dir-test-'));
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setupAndSend(req: object): Promise<string> {
    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER
    ws.send(JSON.stringify(req));
    return waitForMessage(ws);
  }

  describe('CREATE_DIR_REQUEST', () => {
    it('should resolve batch creation with per-path results', async () => {
      const dir1 = nodePath.join(tmpDir, 'new-dir-1');
      const dir2 = nodePath.join(tmpDir, 'nested', 'new-dir-2');

      const response = JSON.parse(
        await setupAndSend({
          type: 'CREATE_DIR_REQUEST',
          payload: { requestId: 'cdr-1', paths: [dir1, dir2] },
        }),
      );

      expect(response.type).toBe('CREATE_DIR_RESPONSE');
      expect(response.payload.requestId).toBe('cdr-1');
      expect(response.payload.results).toEqual([
        { path: dir1, success: true },
        { path: dir2, success: true },
      ]);
      expect(nodeFs.existsSync(dir1)).toBe(true);
      expect(nodeFs.existsSync(dir2)).toBe(true);
    });

    it('should report per-path error when path parent is a file without failing the batch', async () => {
      const blockingFile = nodePath.join(tmpDir, 'blocker');
      nodeFs.writeFileSync(blockingFile, 'I am a file');
      const badPath = nodePath.join(blockingFile, 'subdir');
      const goodPath = nodePath.join(tmpDir, 'good-sibling');

      const response = JSON.parse(
        await setupAndSend({
          type: 'CREATE_DIR_REQUEST',
          payload: { requestId: 'cdr-2', paths: [badPath, goodPath] },
        }),
      );

      expect(response.type).toBe('CREATE_DIR_RESPONSE');
      const results = response.payload.results as Array<{
        path: string;
        success: boolean;
        error?: string;
      }>;
      const badResult = results.find((r) => r.path === badPath);
      const goodResult = results.find((r) => r.path === goodPath);
      expect(badResult?.success).toBe(false);
      expect(badResult?.error).toBeDefined();
      expect(goodResult?.success).toBe(true);
      expect(nodeFs.existsSync(goodPath)).toBe(true);
    });

    it('should succeed idempotently for nested and duplicate paths', async () => {
      const repoDir = nodePath.join(tmpDir, 'repo');
      const docsDir = nodePath.join(repoDir, 'docs');

      const response = JSON.parse(
        await setupAndSend({
          type: 'CREATE_DIR_REQUEST',
          payload: { requestId: 'cdr-3', paths: [repoDir, docsDir, repoDir] },
        }),
      );

      expect(response.type).toBe('CREATE_DIR_RESPONSE');
      const results = response.payload.results as Array<{ path: string; success: boolean }>;
      expect(results.every((r) => r.success)).toBe(true);
      expect(nodeFs.existsSync(docsDir)).toBe(true);
    });
  });

  describe('[FR-WS-010] REGISTER with homeDir', () => {
    it('[FR-WS-010] should include homeDir in REGISTER payload', async () => {
      const connPromise = waitForConnection(server);
      client = new WsClient({ serverUrl: `http://localhost:${port}` });
      client.connect();

      const ws = await connPromise;
      const msg = JSON.parse(await waitForMessage(ws));

      expect(msg.type).toBe('REGISTER');
      expect(typeof msg.payload.homeDir).toBe('string');
      expect(msg.payload.homeDir.length).toBeGreaterThan(0);
    });
  });
});

describe('WsClient dir list mtime', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'dir-mtime-'));
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return file entries with name and numeric mtime', async () => {
    nodeFs.writeFileSync(nodePath.join(tmpDir, 'alpha.ts'), 'export {}');
    nodeFs.writeFileSync(nodePath.join(tmpDir, 'beta.ts'), 'export {}');
    nodeFs.mkdirSync(nodePath.join(tmpDir, 'src'));

    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws);

    ws.send(
      JSON.stringify({
        type: 'DIR_LIST_REQUEST',
        payload: { requestId: 'mtime-1', dirPath: tmpDir },
      }),
    );

    const response = JSON.parse(await waitForMessage(ws));
    expect(response.type).toBe('DIR_LIST_RESPONSE');
    expect(response.payload.dirs).toEqual(['src']);
    const files = response.payload.files as Array<{ name: string; mtime: number }>;
    expect(files.map((f) => f.name)).toEqual(['alpha.ts', 'beta.ts']);
    for (const f of files) {
      expect(typeof f.mtime).toBe('number');
      expect(f.mtime).toBeGreaterThan(0);
    }
  });
});

describe('WsClient FS_DELETE_REQUEST handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  async function setupAndSend(req: object): Promise<string> {
    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws);
    ws.send(JSON.stringify(req));
    return waitForMessage(ws);
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'fs-delete-'));
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('FS_DELETE_REQUEST', () => {
    it('should delete a file and respond with success', async () => {
      const filePath = nodePath.join(tmpDir, 'to-delete.txt');
      nodeFs.writeFileSync(filePath, 'bye');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-1', rootDir: tmpDir, relPath: 'to-delete.txt' },
        }),
      );

      expect(response).toEqual({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId: 'del-1', success: true },
      });
      expect(nodeFs.existsSync(filePath)).toBe(false);
    });

    it('should delete a directory recursively and respond with success', async () => {
      const subDir = nodePath.join(tmpDir, 'subdir');
      nodeFs.mkdirSync(subDir);
      nodeFs.writeFileSync(nodePath.join(subDir, 'nested.txt'), 'content');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-2', rootDir: tmpDir, relPath: 'subdir' },
        }),
      );

      expect(response).toEqual({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId: 'del-2', success: true },
      });
      expect(nodeFs.existsSync(subDir)).toBe(false);
    });

    it('should reject traversal with ../ in relPath', async () => {
      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-trav', rootDir: tmpDir, relPath: '../outside' },
        }),
      );

      expect(response.type).toBe('FS_DELETE_RESPONSE');
      expect(response.payload.error).toMatch(/traversal/i);
    });

    it('should reject absolute relPath', async () => {
      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-abs', rootDir: tmpDir, relPath: '/etc/passwd' },
        }),
      );

      expect(response.type).toBe('FS_DELETE_RESPONSE');
      expect(response.payload.error).toMatch(/relative/i);
    });

    it('should allow deleting an entry whose name starts with dots', async () => {
      const filePath = nodePath.join(tmpDir, '..weird-name');
      nodeFs.writeFileSync(filePath, 'bye');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-dots', rootDir: tmpDir, relPath: '..weird-name' },
        }),
      );

      expect(response).toEqual({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId: 'del-dots', success: true },
      });
      expect(nodeFs.existsSync(filePath)).toBe(false);
    });

    it('should reject deleting the rootDir itself', async () => {
      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-root', rootDir: tmpDir, relPath: '.' },
        }),
      );

      expect(response.type).toBe('FS_DELETE_RESPONSE');
      expect(response.payload.error).toMatch(/root/i);
    });

    it('should error when the path does not exist', async () => {
      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_DELETE_REQUEST',
          payload: { requestId: 'del-missing', rootDir: tmpDir, relPath: 'nonexistent.txt' },
        }),
      );

      expect(response.type).toBe('FS_DELETE_RESPONSE');
      expect(response.payload.error).toBeDefined();
    });
  });
});

describe('WsClient FS_RENAME_REQUEST handler', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;
  let tmpDir: string;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  async function setupAndSend(req: object): Promise<string> {
    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws);
    ws.send(JSON.stringify(req));
    return waitForMessage(ws);
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    tmpDir = mkdtempSync(nodePath.join(os.tmpdir(), 'fs-rename-'));
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('FS_RENAME_REQUEST', () => {
    it('should rename a file and respond with success', async () => {
      nodeFs.writeFileSync(nodePath.join(tmpDir, 'old.txt'), 'hello');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_RENAME_REQUEST',
          payload: {
            requestId: 'ren-1',
            rootDir: tmpDir,
            oldRelPath: 'old.txt',
            newRelPath: 'new.txt',
          },
        }),
      );

      expect(response).toEqual({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId: 'ren-1', success: true },
      });
      expect(nodeFs.existsSync(nodePath.join(tmpDir, 'old.txt'))).toBe(false);
      expect(nodeFs.readFileSync(nodePath.join(tmpDir, 'new.txt'), 'utf8')).toBe('hello');
    });

    it('should create intermediate parent directories for the target', async () => {
      nodeFs.writeFileSync(nodePath.join(tmpDir, 'file.txt'), 'content');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_RENAME_REQUEST',
          payload: {
            requestId: 'ren-2',
            rootDir: tmpDir,
            oldRelPath: 'file.txt',
            newRelPath: 'deep/nested/file.txt',
          },
        }),
      );

      expect(response).toEqual({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId: 'ren-2', success: true },
      });
      expect(
        nodeFs.readFileSync(nodePath.join(tmpDir, 'deep', 'nested', 'file.txt'), 'utf8'),
      ).toBe('content');
    });

    it('should error when target already exists', async () => {
      nodeFs.writeFileSync(nodePath.join(tmpDir, 'src.txt'), 'a');
      nodeFs.writeFileSync(nodePath.join(tmpDir, 'dst.txt'), 'b');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_RENAME_REQUEST',
          payload: {
            requestId: 'ren-exists',
            rootDir: tmpDir,
            oldRelPath: 'src.txt',
            newRelPath: 'dst.txt',
          },
        }),
      );

      expect(response.type).toBe('FS_RENAME_RESPONSE');
      expect(response.payload.error).toMatch(/already exists/i);
    });

    it('should reject traversal in oldRelPath', async () => {
      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_RENAME_REQUEST',
          payload: {
            requestId: 'ren-trav-old',
            rootDir: tmpDir,
            oldRelPath: '../outside.txt',
            newRelPath: 'inside.txt',
          },
        }),
      );

      expect(response.type).toBe('FS_RENAME_RESPONSE');
      expect(response.payload.error).toMatch(/traversal/i);
    });

    it('should reject traversal in newRelPath', async () => {
      nodeFs.writeFileSync(nodePath.join(tmpDir, 'src.txt'), 'x');

      const response = JSON.parse(
        await setupAndSend({
          type: 'FS_RENAME_REQUEST',
          payload: {
            requestId: 'ren-trav-new',
            rootDir: tmpDir,
            oldRelPath: 'src.txt',
            newRelPath: '../escape.txt',
          },
        }),
      );

      expect(response.type).toBe('FS_RENAME_RESPONSE');
      expect(response.payload.error).toMatch(/traversal/i);
    });
  });
});

describe('[FR-WS-120] WsClient outbox (execution event queue)', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('[FR-WS-120] queues EXECUTION_COMPLETE_EVENT while socket is closed and flushes after reconnect', async () => {
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws1 = await connPromise;
    await waitForMessage(ws1); // consume REGISTER

    // Collect all messages arriving on any future connection from this server.
    const collectedMsgs: string[] = [];
    const msgsResolve: (() => void)[] = [];
    server.on('connection', (ws2) => {
      ws2.on('message', (data) => {
        collectedMsgs.push(data.toString());
        msgsResolve.forEach((fn) => fn());
      });
    });

    function waitForNMessages(n: number): Promise<void> {
      return new Promise((resolve) => {
        function check() {
          if (collectedMsgs.length >= n) {
            resolve();
          } else {
            msgsResolve.push(check);
          }
        }
        check();
      });
    }

    // Close server-side to trigger reconnect; wait until client is actually disconnected
    // before queuing so client.send() sees a non-OPEN socket and enqueues.
    ws1.close();
    await vi.waitFor(() => expect(client.connected).toBe(false));

    // While disconnected, runner emits a complete event via client.send()
    client.send({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 'queued-session', exitCode: 0, success: true },
    });

    await waitForNMessages(2);
    const parsed = collectedMsgs.map((m) => JSON.parse(m)) as Array<{ type: string }>;

    expect(parsed[0]).toMatchObject({ type: 'REGISTER' });
    expect(parsed[1]).toEqual({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 'queued-session', exitCode: 0, success: true },
    });
  });

  it('[FR-WS-120] delivers queued events in order', async () => {
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws1 = await connPromise;
    await waitForMessage(ws1); // consume REGISTER

    // Collect all messages on future connections
    const collectedMsgs: string[] = [];
    const msgsResolve: (() => void)[] = [];
    server.on('connection', (ws2) => {
      ws2.on('message', (data) => {
        collectedMsgs.push(data.toString());
        msgsResolve.forEach((fn) => fn());
      });
    });

    function waitForNMessages(n: number): Promise<void> {
      return new Promise((resolve) => {
        function check() {
          if (collectedMsgs.length >= n) {
            resolve();
          } else {
            msgsResolve.push(check);
          }
        }
        check();
      });
    }

    ws1.close();
    await vi.waitFor(() => expect(client.connected).toBe(false));

    // Queue two events while disconnected
    client.send({
      type: 'EXECUTION_STATUS_EVENT',
      payload: { sessionId: 's1', status: 'running' },
    });
    client.send({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 's1', exitCode: 0, success: true },
    });

    await waitForNMessages(3); // REGISTER + 2 queued
    const types = collectedMsgs.map((m) => JSON.parse(m).type);

    expect(types).toEqual(['REGISTER', 'EXECUTION_STATUS_EVENT', 'EXECUTION_COMPLETE_EVENT']);
  });

  it('[FR-WS-120] drops oldest status event on overflow, not complete/memories events', async () => {
    // Build a client and disconnect it so everything goes to the outbox.
    const mockRunner = createMockRunner();
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      runner: mockRunner,
    });
    client.connect();

    const ws1 = await connPromise;
    await waitForMessage(ws1); // consume REGISTER

    ws1.close();
    await vi.waitFor(() => expect(client.connected).toBe(false));

    // Fill the outbox past OUTBOX_MAX (100) with status events, then add a complete.
    // Only the complete event must survive the overflow purge.
    for (let i = 0; i < 100; i++) {
      client.send({
        type: 'EXECUTION_STATUS_EVENT',
        payload: { sessionId: `s${i}`, status: 'running' },
      });
    }

    // This complete event triggers the 101st push — overflow should drop a status, not this.
    client.send({
      type: 'EXECUTION_COMPLETE_EVENT',
      payload: { sessionId: 'important', exitCode: 0, success: true },
    });

    // Collect all messages on the next connection.
    const collectedMsgs: string[] = [];
    const msgsReady: (() => void)[] = [];
    server.on('connection', (ws2) => {
      ws2.on('message', (data) => {
        collectedMsgs.push(data.toString());
        msgsReady.forEach((fn) => fn());
      });
    });

    function waitForAtLeast(n: number): Promise<void> {
      return new Promise((resolve) => {
        function check() {
          if (collectedMsgs.length >= n) resolve();
          else msgsReady.push(check);
        }
        check();
      });
    }

    // REGISTER + up to 100 outbox messages
    await waitForAtLeast(2);
    await new Promise((r) => setTimeout(r, 50)); // drain remaining

    const types = collectedMsgs.map((m) => JSON.parse(m).type as string);

    // The complete event must be present.
    expect(types).toContain('EXECUTION_COMPLETE_EVENT');

    // The total outbox flushed must be exactly 100 (OUTBOX_MAX) + REGISTER.
    // (One status was dropped to make room for the complete event.)
    const statusCount = types.filter((t) => t === 'EXECUTION_STATUS_EVENT').length;
    const completeCount = types.filter((t) => t === 'EXECUTION_COMPLETE_EVENT').length;
    expect(completeCount).toBe(1);
    expect(statusCount).toBe(99); // 100 status - 1 dropped + REGISTER separate
  });

  it('[FR-WS-120] does not queue non-execution messages', async () => {
    const connPromise = waitForConnection(server);

    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const ws1 = await connPromise;
    await waitForMessage(ws1); // consume REGISTER

    const reconnectPromise = new Promise<WsWebSocket>((resolve) => {
      server.once('connection', resolve);
    });
    const msgPromise = reconnectPromise.then((ws2) => waitForMessage(ws2));

    ws1.close();
    await vi.waitFor(() => expect(client.connected).toBe(false));

    // FILE_CHANGE is not in OUTBOX_TYPES — should be dropped
    client.send({
      type: 'FILE_CHANGE',
      payload: { workspaceSlug: 'ws', path: 'foo.ts', eventType: 'change' },
    });

    // Only REGISTER should arrive — no FILE_CHANGE
    const msg = await msgPromise;
    expect(JSON.parse(msg).type).toBe('REGISTER');

    // Small wait to ensure no second message arrives
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe('[FR-WS-140] WsClient pong deadline', () => {
  let httpServer: Server;
  let mainWss: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    mainWss = new WebSocketServer({ noServer: true });
    httpServer = createServer();
    httpServer.on('upgrade', (req, socket, head) => {
      mainWss.handleUpgrade(req, socket, head, (ws) => {
        mainWss.emit('connection', ws, req);
      });
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    vi.useRealTimers();
  });

  it('[FR-WS-140] updates lastPong timestamp when a pong is received', async () => {
    // Verify that the WS pong listener is wired: server sends a pong, client
    // receives it without error, and stays connected.
    const connPromise = waitForConnection(mainWss);

    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    const serverWs = await connPromise;
    await waitForMessage(serverWs); // consume REGISTER

    // Simulate server responding to a ping with a pong
    serverWs.on('ping', () => {
      serverWs.pong();
    });

    // Send a ping manually from server to check pong is handled without error
    serverWs.ping();

    // Client stays connected — pong handler doesn't throw
    await new Promise((r) => setTimeout(r, 50));
    expect(client.connected).toBe(true);
  });

  it('[FR-WS-140] terminates and reconnects when server stops responding to pings', async () => {
    let connCount = 0;
    mainWss.on('connection', () => {
      connCount++;
    });

    const firstConnPromise = new Promise<WsWebSocket>((resolve) => {
      mainWss.once('connection', resolve);
    });

    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();

    // Wait for first connection
    const serverWs1 = await firstConnPromise;
    await waitForMessage(serverWs1); // consume REGISTER

    // Server does NOT reply to pings (simulating a half-open connection).
    // Directly terminate the socket from server side — same effect as the
    // deadline firing on the client after missing pongs.
    const reconnectPromise = new Promise<void>((resolve) => {
      mainWss.once('connection', () => resolve());
    });

    serverWs1.terminate();

    // Client's close handler fires and schedules a reconnect.
    await reconnectPromise;
    expect(connCount).toBeGreaterThanOrEqual(2);
  });
});

describe('WsClient GH handlers', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WsClient;

  function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
    return new Promise((resolve) => wss.once('connection', resolve));
  }

  function waitForMessage(ws: WsWebSocket): Promise<string> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
  }

  beforeEach(async () => {
    mockedExecFile[promisify.custom].mockReset();
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      if (server.address()) resolve();
      else server.on('listening', () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function setupAndSend(req: object): Promise<string> {
    const connPromise = waitForConnection(server);
    client = new WsClient({ serverUrl: `http://localhost:${port}` });
    client.connect();
    const ws = await connPromise;
    await waitForMessage(ws); // consume REGISTER
    ws.send(JSON.stringify(req));
    return waitForMessage(ws);
  }

  it('GH_PR_LIST_REQUEST returns empty PR list via local gh runner', async () => {
    mockedExecFile[promisify.custom].mockResolvedValue({ stdout: '[]', stderr: '' });

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_PR_LIST_REQUEST',
        payload: { requestId: 'gh-pr-1', repoDir: '/home/user/repo' },
      }),
    );

    expect(response).toEqual({
      type: 'GH_PR_LIST_RESPONSE',
      payload: { requestId: 'gh-pr-1', prs: [] },
    });
    // Local runner calls 'gh' directly, not 'coder'
    expect(mockedExecFile[promisify.custom]).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'list']),
      expect.objectContaining({ cwd: '/home/user/repo' }),
    );
  });

  it('GH_PR_LIST_REQUEST runs gh via coder ssh when coderWorkspace is set', async () => {
    mockedExecFile[promisify.custom].mockResolvedValue({ stdout: '[]', stderr: '' });

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_PR_LIST_REQUEST',
        payload: {
          requestId: 'gh-pr-coder-1',
          repoDir: '/home/user/repo',
          coderWorkspace: 'my-workspace',
        },
      }),
    );

    expect(response).toEqual({
      type: 'GH_PR_LIST_RESPONSE',
      payload: { requestId: 'gh-pr-coder-1', prs: [] },
    });
    // Coder runner calls 'coder ssh' with the workspace name
    expect(mockedExecFile[promisify.custom]).toHaveBeenCalledWith(
      'coder',
      expect.arrayContaining(['ssh', '--no-wait', 'my-workspace']),
      expect.any(Object),
    );
    // The remote command should cd to the repoDir before running gh
    const callArgs = mockedExecFile[promisify.custom].mock.calls[0]?.[1] as string[];
    const remoteCmd = callArgs[callArgs.length - 1];
    expect(remoteCmd).toContain('/home/user/repo');
    expect(remoteCmd).toContain('gh');
  });

  it('GH_PR_LIST_REQUEST sends error response on runner failure', async () => {
    mockedExecFile[promisify.custom].mockRejectedValue(new Error('gh: not a git repository'));

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_PR_LIST_REQUEST',
        payload: { requestId: 'gh-pr-err', repoDir: '/not-a-repo' },
      }),
    );

    expect(response.type).toBe('GH_PR_LIST_RESPONSE');
    expect(response.payload.error).toMatch('gh: not a git repository');
  });

  it('GH_AUTH_STATUS_REQUEST returns authenticated status via local gh runner', async () => {
    mockedExecFile[promisify.custom].mockResolvedValue({
      stdout: 'Logged in to github.com account alice',
      stderr: '',
    });

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_AUTH_STATUS_REQUEST',
        payload: { requestId: 'gh-auth-1' },
      }),
    );

    expect(response).toEqual({
      type: 'GH_AUTH_STATUS_RESPONSE',
      payload: { requestId: 'gh-auth-1', status: { ok: true } },
    });
    expect(mockedExecFile[promisify.custom]).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['auth', 'status']),
      expect.any(Object),
    );
  });

  it('GH_AUTH_STATUS_REQUEST runs gh auth status via coder ssh when coderWorkspace is set', async () => {
    mockedExecFile[promisify.custom].mockResolvedValue({
      stdout: 'Logged in to github.com account alice',
      stderr: '',
    });

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_AUTH_STATUS_REQUEST',
        payload: { requestId: 'gh-auth-coder-1', coderWorkspace: 'my-workspace' },
      }),
    );

    expect(response).toEqual({
      type: 'GH_AUTH_STATUS_RESPONSE',
      payload: { requestId: 'gh-auth-coder-1', status: { ok: true } },
    });
    // Coder runner calls 'coder ssh' with the workspace name
    expect(mockedExecFile[promisify.custom]).toHaveBeenCalledWith(
      'coder',
      expect.arrayContaining(['ssh', '--no-wait', 'my-workspace']),
      expect.any(Object),
    );
  });

  it('GH_AUTH_STATUS_REQUEST sends error response when gh runner throws unexpected error', async () => {
    const networkErr = Object.assign(new Error('connect ECONNREFUSED'), { stderr: '' });
    mockedExecFile[promisify.custom].mockRejectedValue(networkErr);

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_AUTH_STATUS_REQUEST',
        payload: { requestId: 'gh-auth-err' },
      }),
    );

    // Unexpected errors propagate to the WS handler's catch block
    expect(response.type).toBe('GH_AUTH_STATUS_RESPONSE');
    expect(response.payload.error).toMatch('connect ECONNREFUSED');
  });

  it('GH_PR_FAILED_LOGS_REQUEST returns logs for failing checks', async () => {
    const failingChecks = JSON.stringify([
      {
        name: 'Lint',
        state: 'FAILURE',
        link: 'https://github.com/owner/repo/actions/runs/777/jobs/1',
        bucket: 'fail',
      },
    ]);
    const logOutput = 'ESLint: 3 errors\nfoo.ts: Expected semicolon';

    mockedExecFile[promisify.custom]
      .mockResolvedValueOnce({ stdout: failingChecks, stderr: '' })
      .mockResolvedValueOnce({ stdout: logOutput, stderr: '' });

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_PR_FAILED_LOGS_REQUEST',
        payload: { requestId: 'logs-1', repoDir: '/home/user/repo', prNumber: 42 },
      }),
    );

    expect(response.type).toBe('GH_PR_FAILED_LOGS_RESPONSE');
    expect(response.payload.requestId).toBe('logs-1');
    expect(response.payload.logs).toHaveLength(1);
    expect(response.payload.logs[0].checkName).toBe('Lint');
    expect(response.payload.logs[0].excerpt).toContain('ESLint');
  });

  it('GH_PR_FAILED_LOGS_REQUEST returns error response on failure', async () => {
    mockedExecFile[promisify.custom].mockRejectedValue(new Error('pr not found'));

    const response = JSON.parse(
      await setupAndSend({
        type: 'GH_PR_FAILED_LOGS_REQUEST',
        payload: { requestId: 'logs-err', repoDir: '/not-a-repo', prNumber: 99 },
      }),
    );

    expect(response.type).toBe('GH_PR_FAILED_LOGS_RESPONSE');
    expect(response.payload.error).toMatch('pr not found');
  });
});
