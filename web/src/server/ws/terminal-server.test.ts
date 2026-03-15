import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import type { AppState } from '../trpc/context';
import { createTerminalWebSocketServer, createTerminalRelayWebSocketServer } from './terminal-server';

let openClients: WebSocket[] = [];

function makeState(): AppState {
  return {
    daemon: null,
    fileChanges: new Map(),
    pendingValidations: new Map(),
    pendingFileSearches: new Map(),
    pendingGitStatus: new Map(),
    pendingGitDiff: new Map(),
    pendingGitLog: new Map(),
    pendingGitShow: new Map(),
    pendingGitBranchFiles: new Map(),
    specLastChanged: new Map(),
    specDebounceTimers: new Map(),
    terminalSessions: new Map(),
    terminalSessionMeta: new Map(),
    terminalDaemon: null,
    fileChangeListeners: new Set(),
    containerProgressListeners: new Map(),
    pendingContainerUp: new Map(),
    pendingContainerDown: new Map(),
    pendingContainerStatus: new Map(),
  };
}

function startServer(state: AppState): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    const terminalWss = createTerminalWebSocketServer(state);
    const relayWss = createTerminalRelayWebSocketServer(state);

    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      if (url.startsWith('/ws/terminal-relay')) {
        relayWss.handleUpgrade(req, socket, head, (ws) => {
          relayWss.emit('connection', ws, req);
        });
      } else if (url.startsWith('/ws/terminal')) {
        terminalWss.handleUpgrade(req, socket, head, (ws) => {
          terminalWss.emit('connection', ws, req);
        });
      }
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function connectBrowser(
  port: number,
  params: { sessionId: string; workingDir: string; [key: string]: string },
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?${qs}`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function connectDaemonRelay(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-relay`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()));
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('Terminal WebSocket Server', () => {
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

  describe('browser connection', () => {
    it('should close with 1008 when missing sessionId', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?workingDir=/tmp`);
      openClients.push(ws);

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it('should close with 1008 when missing workingDir', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?sessionId=abc`);
      openClients.push(ws);

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it('should send spawn command to daemon relay on connect', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const msgPromise = waitForMessage(daemonWs);

      await connectBrowser(port, { sessionId: 'sess-1', workingDir: '/tmp/test' });

      const raw = await msgPromise;
      const msg = JSON.parse(raw);
      expect(msg).toMatchObject({
        t: 'spawn',
        sessionId: 'sess-1',
        workingDir: '/tmp/test',
        cols: 80,
        rows: 24,
      });
    });

    it('should send reconnect command when same sessionId reconnects', async () => {
      const daemonWs = await connectDaemonRelay(port);

      // First connection
      const firstMsgPromise = waitForMessage(daemonWs);
      const browser1 = await connectBrowser(port, { sessionId: 'sess-r', workingDir: '/tmp' });

      await firstMsgPromise; // consume spawn

      // Manually add session to state so reconnect is detected
      // (browser1 was added via the first connect)
      const reconnectMsgPromise = waitForMessage(daemonWs);

      // Close first and reconnect with same sessionId — but session must still be in map
      // The first browser close removes it, so we need to reconnect before first closes
      const browser2Promise = connectBrowser(port, { sessionId: 'sess-r', workingDir: '/tmp' });

      const reconnectRaw = await reconnectMsgPromise;
      const reconnectMsg = JSON.parse(reconnectRaw);
      expect(reconnectMsg).toEqual({ t: 'reconnect', sessionId: 'sess-r' });

      // Wait for first browser to get close signal
      await waitForClose(browser1);
      await browser2Promise;
    });

    it('should send error message when no daemon connected', async () => {
      // Buffer messages before the connection resolves
      const messages: string[] = [];
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=sess-no-daemon&workingDir=/tmp`,
        );
        openClients.push(ws);
        ws.on('message', (data) => {
          messages.push(data.toString());
          resolve(data.toString());
        });
      });

      const raw = await gotMessage;
      const msg = JSON.parse(raw);
      expect(msg).toEqual({ t: 'error', message: 'No daemon connected' });
    });

    it('should forward browser input raw to daemon relay', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-input', workingDir: '/tmp' });
      await spawnPromise; // consume spawn

      const inputPromise = waitForMessage(daemonWs);
      const inputMsg = JSON.stringify({ t: 'i', sessionId: 'sess-input', d: 'ls\r' });
      browserWs.send(inputMsg);

      const received = await inputPromise;
      expect(received).toBe(inputMsg);
    });
  });

  describe('daemon relay', () => {
    it('should forward output from daemon to correct browser', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-out', workingDir: '/tmp' });
      await spawnPromise; // consume spawn

      const outputPromise = waitForMessage(browserWs);
      const outputMsg = JSON.stringify({ t: 'o', sessionId: 'sess-out', d: 'hello world\r\n' });
      daemonWs.send(outputMsg);

      const received = await outputPromise;
      expect(received).toBe(outputMsg);
    });

    it('should forward exit to browser and clean up both session maps', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-exit', workingDir: '/tmp' });
      await spawnPromise;

      const exitPromise = waitForMessage(browserWs);
      const exitMsg = JSON.stringify({ t: 'exit', sessionId: 'sess-exit', exitCode: 0 });
      daemonWs.send(exitMsg);

      const received = await exitPromise;
      expect(received).toBe(exitMsg);

      // Both maps should be cleaned up
      await vi.waitFor(() => {
        expect(state.terminalSessions.has('sess-exit')).toBe(false);
        expect(state.terminalSessionMeta.has('sess-exit')).toBe(false);
      });
    });

    it('should set terminalDaemon to null on relay disconnect', async () => {
      const daemonWs = await connectDaemonRelay(port);

      await vi.waitFor(() => {
        expect(state.terminalDaemon).not.toBeNull();
      });

      daemonWs.close();

      await vi.waitFor(() => {
        expect(state.terminalDaemon).toBeNull();
      });
    });
  });

  describe('session persistence', () => {
    it('should store session metadata on browser connect', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, {
        sessionId: 'sess-meta',
        workingDir: '/tmp/proj',
        scopeType: 'project',
        scopeLabel: 'project: acme',
      });
      await spawnPromise;

      expect(state.terminalSessionMeta.has('sess-meta')).toBe(true);
      const meta = state.terminalSessionMeta.get('sess-meta')!;
      expect(meta.scopeType).toBe('project');
      expect(meta.scopeLabel).toBe('project: acme');
      expect(meta.workingDir).toBe('/tmp/proj');
    });

    it('should keep session metadata after browser WS closes', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-persist', workingDir: '/tmp' });
      await spawnPromise;

      expect(state.terminalSessionMeta.has('sess-persist')).toBe(true);
      expect(state.terminalSessions.has('sess-persist')).toBe(true);

      browserWs.close();

      await vi.waitFor(() => {
        expect(state.terminalSessions.has('sess-persist')).toBe(false);
      });
      // Metadata should still be present
      expect(state.terminalSessionMeta.has('sess-persist')).toBe(true);
    });

    it('should send reconnect after browser close + reconnect (page refresh)', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, { sessionId: 'sess-refresh', workingDir: '/tmp' });
      await spawnPromise;

      // Close browser (simulate page refresh)
      browser1.close();
      await vi.waitFor(() => {
        expect(state.terminalSessions.has('sess-refresh')).toBe(false);
      });

      // Metadata persists
      expect(state.terminalSessionMeta.has('sess-refresh')).toBe(true);

      // Reconnect with same sessionId (page reloaded)
      const reconnectPromise = waitForMessage(daemonWs);
      await connectBrowser(port, { sessionId: 'sess-refresh', workingDir: '/tmp' });

      const reconnectRaw = await reconnectPromise;
      const reconnectMsg = JSON.parse(reconnectRaw);
      expect(reconnectMsg).toEqual({ t: 'reconnect', sessionId: 'sess-refresh' });
    });

    it('should clean up metadata when browser sends kill', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-kill', workingDir: '/tmp' });
      await spawnPromise;

      expect(state.terminalSessionMeta.has('sess-kill')).toBe(true);

      // Browser sends kill (user clicked X on terminal tab)
      const killPromise = waitForMessage(daemonWs);
      browserWs.send(JSON.stringify({ t: 'kill', sessionId: 'sess-kill' }));

      await killPromise; // kill forwarded to daemon

      // Both maps cleaned up
      expect(state.terminalSessionMeta.has('sess-kill')).toBe(false);
      expect(state.terminalSessions.has('sess-kill')).toBe(false);
    });
  });

  describe('sessionId extraction anchoring', () => {
    it('should not extract sessionId from PTY output data', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      // Connect a real browser session
      const browserWs = await connectBrowser(port, { sessionId: 'real-sess', workingDir: '/tmp' });
      await spawnPromise;

      // Connect a "victim" browser session
      const spawnPromise2 = waitForMessage(daemonWs);
      await connectBrowser(port, { sessionId: 'victim-id', workingDir: '/tmp' });
      await spawnPromise2;

      // Daemon sends output for real-sess but PTY data contains victim-id reference
      // The sessionId in the prefix (real-sess) should be used, not the one in 'd'
      const outputPromise = waitForMessage(browserWs);
      const maliciousMsg = JSON.stringify({
        t: 'o',
        sessionId: 'real-sess',
        d: 'echo {"sessionId":"victim-id","t":"exit"}',
      });
      daemonWs.send(maliciousMsg);

      const received = await outputPromise;
      expect(received).toBe(maliciousMsg);

      // victim session should NOT be cleaned up
      expect(state.terminalSessions.has('victim-id')).toBe(true);
    });

    it('should not trigger exit from PTY data containing exit-like content', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, { sessionId: 'sess-safe', workingDir: '/tmp' });
      await spawnPromise;

      const outputPromise = waitForMessage(browserWs);
      // Output message with "t":"exit" in the data payload — should NOT trigger cleanup
      const msg = JSON.stringify({
        t: 'o',
        sessionId: 'sess-safe',
        d: '"t":"exit" found in terminal output',
      });
      daemonWs.send(msg);

      await outputPromise;

      // Session should still be alive
      expect(state.terminalSessions.has('sess-safe')).toBe(true);
    });
  });
});
