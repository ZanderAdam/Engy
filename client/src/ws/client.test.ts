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
} from '@engy/common';
import type { TerminalManager } from '../terminal/manager.js';
import type { PersistentSession } from '../terminal/types.js';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Runner } from '../runner/index.js';
import { EventEmitter } from 'node:events';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
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
    expect(deriveTerminalRelayUrl('http://localhost:3000')).toBe('ws://localhost:3000/ws/terminal-relay');
  });

  it('converts https to wss with terminal-relay path', () => {
    expect(deriveTerminalRelayUrl('https://example.com')).toBe('wss://example.com/ws/terminal-relay');
  });
});

describe('computeBackoff', () => {
  it('starts at ~1s for attempt 0', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(0));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(800); // 1000 - 20%
      expect(delay).toBeLessThanOrEqual(1200); // 1000 + 20%
    }
  });

  it('doubles with each attempt', () => {
    const delays = Array.from({ length: 100 }, () => computeBackoff(1));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(1600); // 2000 - 20%
      expect(delay).toBeLessThanOrEqual(2400); // 2000 + 20%
    }
  });

  it('caps at 30s max', () => {
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

  it('sends REGISTER on connect', async () => {
    const connPromise = waitForConnection(server);

    client = new WsClient({
      serverUrl: `http://localhost:${port}`,
      onWorkspacesSync: vi.fn(),
    });
    client.connect();

    const ws = await connPromise;
    const msg = await waitForMessage(ws);
    expect(JSON.parse(msg)).toEqual({ type: 'REGISTER', payload: {} });
  });

  it('calls onWorkspacesSync when receiving WORKSPACES_SYNC', async () => {
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

  it('reconnects after server closes connection', async () => {
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
    expect(JSON.parse(msg)).toEqual({ type: 'REGISTER', payload: {} });
  });

  it('does not reconnect after intentional close', async () => {
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
    stop: vi.fn(),
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
        serverUrl: `http://localhost:${port}`,
        env: undefined,
      }),
    );
  });

  it('delegates EXECUTION_STOP_REQUEST to Runner.stop and sends response', async () => {
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

    expect(mockRunner.stop).toHaveBeenCalled();
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
        serverUrl: `http://localhost:${port}`,
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
    const mockChild = Object.assign(new EventEmitter(), {
      stdin: { write: stdinWrite, end: stdinEnd },
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
        filePath: '/home/user/output.txt',
        content: 'hello world',
      },
    };
    ws.send(JSON.stringify(request));

    await vi.waitFor(() => {
      expect(stdinWrite).toHaveBeenCalledWith('hello world');
    });

    // Simulate successful close
    mockChild.emit('close', 0);

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PUSH_RESPONSE',
      payload: { requestId: 'push-1', success: true },
    });
  });

  it('responds to REMOTE_FILE_PUSH_REQUEST with error on failure', async () => {
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    const mockChild = Object.assign(new EventEmitter(), {
      stdin: { write: stdinWrite, end: stdinEnd },
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
        filePath: '/home/user/output.txt',
        content: 'data',
      },
    };
    ws.send(JSON.stringify(request));

    await vi.waitFor(() => {
      expect(stdinWrite).toHaveBeenCalled();
    });

    // Simulate non-zero exit
    mockChild.emit('close', 1);

    const response = await waitForMessage(ws);
    expect(JSON.parse(response)).toEqual({
      type: 'REMOTE_FILE_PUSH_RESPONSE',
      payload: { requestId: 'push-2', error: 'coder ssh push failed (exit 1)' },
    });
  });
});
