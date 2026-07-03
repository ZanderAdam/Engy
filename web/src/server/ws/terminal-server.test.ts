import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { createAppState, type AppState } from '../trpc/context';
import {
  createTerminalWebSocketServer,
  createTerminalRelayWebSocketServer,
} from './terminal-server';
import { connectWorker, createDispatch } from '../terminal-dispatch';

let openClients: WebSocket[] = [];

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

  describe('[FR-TERMINAL-010] browser connection', () => {
    it('should close with 1008 when missing sessionId', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?workingDir=/tmp`);
      openClients.push(ws);

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it('[FR-TERMINAL-010] should close with 1008 when missing workingDir', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?sessionId=abc`);
      openClients.push(ws);

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it('[FR-TERMINAL-020] should send spawn command to daemon relay on connect', async () => {
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

    it('[FR-TERMINAL-050] should send reconnect command when same sessionId reconnects (multi-attach)', async () => {
      const daemonWs = await connectDaemonRelay(port);

      // First connection
      const firstMsgPromise = waitForMessage(daemonWs);
      const browser1 = await connectBrowser(port, { sessionId: 'sess-r', workingDir: '/tmp' });

      await firstMsgPromise; // consume spawn

      // Meta persists from first spawn — second connect with same sessionId triggers reconnect
      const reconnectMsgPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, { sessionId: 'sess-r', workingDir: '/tmp' });

      const reconnectRaw = await reconnectMsgPromise;
      const reconnectMsg = JSON.parse(reconnectRaw);
      expect(reconnectMsg).toEqual({ t: 'reconnect', sessionId: 'sess-r' });

      // Both browsers should remain connected (multi-attach — no replacement)
      expect(browser1.readyState).toBe(WebSocket.OPEN);
      expect(browser2.readyState).toBe(WebSocket.OPEN);
    });

    it('should send error message when no daemon connected', async () => {
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=sess-no-daemon&workingDir=/tmp`,
        );
        openClients.push(ws);
        ws.on('message', (data) => resolve(data.toString()));
      });

      const raw = await gotMessage;
      const msg = JSON.parse(raw);
      expect(msg).toEqual({ t: 'error', message: 'No daemon connected' });
    });

    it('[FR-TERMINAL-060] should forward browser input raw to daemon relay', async () => {
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
    it('[FR-TERMINAL-060] should forward output from daemon to correct browser', async () => {
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

    it('[FR-TERMINAL-150] should persist agentType from the connection query on the session meta', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, {
        sessionId: 'sess-agent',
        workingDir: '/tmp',
        agentType: 'codex',
      });
      await spawnPromise;

      expect(state.terminalSessionMeta.get('sess-agent')?.agentType).toBe('codex');
    });

    it('[FR-TERMINAL-170] should deliver a queued dispatch when the worker transitions to idle', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);
      await connectBrowser(port, { sessionId: 'sess-w', workingDir: '/tmp' });
      await spawnPromise;

      state.terminalSessionMeta.get('sess-w')!.activityState = 'active';
      connectWorker(state, 'sess-w', 'busy worker');
      const entry = createDispatch(state, 'sess-w', 'queued task');
      expect(entry.status).toBe('queued');

      const inputPromise = waitForMessage(daemonWs);
      daemonWs.send(JSON.stringify({ t: 'act', sessionId: 'sess-w', state: 'idle' }));

      const raw = await inputPromise;
      const frame = JSON.parse(raw);
      expect(frame.t).toBe('i');
      expect(frame.sessionId).toBe('sess-w');
      expect(frame.d).toContain('queued task');
      expect(frame.d).toContain(`[engy-dispatch ${entry.correlationId}]`);
    });

    it('[FR-TERMINAL-180] should fail unsettled dispatches and disconnect the worker on exit', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);
      const browserWs = await connectBrowser(port, { sessionId: 'sess-dw', workingDir: '/tmp' });
      await spawnPromise;

      connectWorker(state, 'sess-dw', 'doomed worker');
      const entry = createDispatch(state, 'sess-dw', 'task');

      const exitPromise = waitForMessage(browserWs);
      daemonWs.send(JSON.stringify({ t: 'exit', sessionId: 'sess-dw', exitCode: 0 }));
      await exitPromise;

      await vi.waitFor(() => {
        expect(state.dispatches.get(entry.correlationId)?.status).toBe('failed');
        expect(state.dispatchWorkers.has('sess-dw')).toBe(false);
      });
    });

    it('[FR-TERMINAL-190] should buffer output tails for connected workers only', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);
      const browserWs = await connectBrowser(port, { sessionId: 'sess-tail', workingDir: '/tmp' });
      await spawnPromise;

      connectWorker(state, 'sess-tail', 'tracked worker');
      const outputPromise = waitForMessage(browserWs);
      daemonWs.send(JSON.stringify({ t: 'o', sessionId: 'sess-tail', d: 'worker output' }));
      await outputPromise;

      await vi.waitFor(() => {
        expect(state.terminalOutputTails.get('sess-tail')).toContain('worker output');
      });
    });

    it('[FR-TERMINAL-130] should persist activity state on the session meta from an act message', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, {
        sessionId: 'sess-act',
        workingDir: '/tmp',
        scopeType: 'project',
        projectSlug: 'my-proj',
      });
      await spawnPromise;

      daemonWs.send(JSON.stringify({ t: 'act', sessionId: 'sess-act', state: 'waiting' }));

      await vi.waitFor(() => {
        expect(state.terminalSessionMeta.get('sess-act')?.activityState).toBe('waiting');
      });
    });

    it('[FR-TERMINAL-090] should forward exit to browser and clean up both session maps', async () => {
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

    it('[FR-TERMINAL-100] should retain terminalSessionMeta on relay disconnect for respawn', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, { sessionId: 'sess-relay-meta', workingDir: '/tmp' });
      await spawnPromise;

      expect(state.terminalSessionMeta.has('sess-relay-meta')).toBe(true);

      daemonWs.close();

      await vi.waitFor(() => {
        expect(state.terminalDaemon).toBeNull();
      });

      // Meta is retained so the sync handler can respawn sessions with active browsers
      expect(state.terminalSessionMeta.has('sess-relay-meta')).toBe(true);
    });

    it('[FR-TERMINAL-100] should set terminalDaemon to null on relay disconnect', async () => {
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

  describe('daemon reconnect during spawn', () => {
    it('should use current daemon after daemon disconnect and reconnect', async () => {
      // Connect first daemon — browser will start connecting to this one
      const daemon1 = await connectDaemonRelay(port);

      // Connect browser which sends spawn
      const spawnPromise = waitForMessage(daemon1);
      const browserWs = await connectBrowser(port, { sessionId: 'sess-fresh', workingDir: '/tmp' });
      const raw = await spawnPromise;
      const msg = JSON.parse(raw);
      expect(msg.t).toBe('spawn');

      // Simulate daemon disconnect + reconnect (new daemon replaces old)
      daemon1.close();
      await vi.waitFor(() => expect(state.terminalDaemon).toBeNull());

      const daemon2 = await connectDaemonRelay(port);
      await vi.waitFor(() => expect(state.terminalDaemon).not.toBeNull());

      // New browser connect should use daemon2 (fresh reference), not stale daemon1
      const spawn2Promise = waitForMessage(daemon2);
      await connectBrowser(port, { sessionId: 'sess-fresh-2', workingDir: '/tmp' });

      const raw2 = await spawn2Promise;
      const msg2 = JSON.parse(raw2);
      expect(msg2).toMatchObject({ t: 'spawn', sessionId: 'sess-fresh-2' });

      browserWs.close();
    });

    it('should send error when daemon disconnects and no new daemon is available', async () => {
      const daemon = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemon);
      await connectBrowser(port, { sessionId: 'sess-pre', workingDir: '/tmp' });
      await spawnPromise;

      // Disconnect daemon
      daemon.close();
      await vi.waitFor(() => expect(state.terminalDaemon).toBeNull());

      // New browser connect without daemon should get error
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=sess-no-daemon-2&workingDir=/tmp`,
        );
        openClients.push(ws);
        ws.on('message', (data) => resolve(data.toString()));
      });

      const raw = await gotMessage;
      const msg = JSON.parse(raw);
      expect(msg).toEqual({ t: 'error', message: 'No daemon connected' });
    });
  });

  describe('session persistence', () => {
    it('[FR-TERMINAL-020] should store session metadata on browser connect', async () => {
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

    it('[FR-TERMINAL-040] should keep session metadata after browser WS closes', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browserWs = await connectBrowser(port, {
        sessionId: 'sess-persist',
        workingDir: '/tmp',
      });
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

    it('[FR-TERMINAL-050] should send reconnect after browser close + reconnect (page refresh)', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, {
        sessionId: 'sess-refresh',
        workingDir: '/tmp',
      });
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

    it('[FR-TERMINAL-080] should send exit to other attached browsers before closing them on kill', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, {
        sessionId: 'sess-kill-ma',
        workingDir: '/tmp',
      });
      await spawnPromise;

      const reconnectPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, {
        sessionId: 'sess-kill-ma',
        workingDir: '/tmp',
      });
      await reconnectPromise;

      // Record browser2's events in arrival order — exit must precede close
      const events: Array<{ kind: 'message'; data: string } | { kind: 'close'; code: number }> = [];
      browser2.on('message', (data) => events.push({ kind: 'message', data: data.toString() }));
      const closed = new Promise<void>((resolve) => {
        browser2.once('close', (code) => {
          events.push({ kind: 'close', code });
          resolve();
        });
      });

      browser1.send(JSON.stringify({ t: 'kill', sessionId: 'sess-kill-ma' }));
      await closed;

      expect(events).toHaveLength(2);
      const [exitEvent, closeEvent] = events;
      if (exitEvent.kind !== 'message') throw new Error('expected exit message before close');
      expect(JSON.parse(exitEvent.data)).toEqual({
        t: 'exit',
        sessionId: 'sess-kill-ma',
        exitCode: 0,
      });
      expect(closeEvent).toEqual({ kind: 'close', code: 1001 });
    });

    it('[FR-TERMINAL-080] should clean up metadata when browser sends kill', async () => {
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

  describe('daemon sync', () => {
    it('[FR-TERMINAL-110] should clean up stale sessions with no browser connected', async () => {
      // Pre-populate meta for a session the daemon has lost
      state.terminalSessionMeta.set('stale-sess', {
        scopeType: 'workspace',
        scopeLabel: 'test',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
      });

      const daemonWs = await connectDaemonRelay(port);

      // Daemon sends sync with empty session list
      daemonWs.send(JSON.stringify({ t: 'sync', sessionIds: [] }));

      await vi.waitFor(() => {
        expect(state.terminalSessionMeta.has('stale-sess')).toBe(false);
      });
    });

    it('[FR-TERMINAL-110] should respawn stale sessions when browser is still connected', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      // Connect a browser session
      await connectBrowser(port, {
        sessionId: 'respawn-sess',
        workingDir: '/tmp/proj',
        scopeType: 'project',
        scopeLabel: 'my-proj',
      });
      await spawnPromise; // consume initial spawn

      // Simulate daemon restart: new relay connects with empty sessions
      daemonWs.close();
      await vi.waitFor(() => expect(state.terminalDaemon).toBeNull());

      const newDaemonWs = await connectDaemonRelay(port);
      const respawnPromise = waitForMessage(newDaemonWs);

      // New daemon sends sync with no sessions
      newDaemonWs.send(JSON.stringify({ t: 'sync', sessionIds: [] }));

      const raw = await respawnPromise;
      const msg = JSON.parse(raw);
      expect(msg).toMatchObject({
        t: 'spawn',
        sessionId: 'respawn-sess',
        workingDir: '/tmp/proj',
        scopeType: 'project',
        scopeLabel: 'my-proj',
      });
    });

    it('should not touch sessions the daemon still has', async () => {
      // Pre-populate meta for a session the daemon still knows about
      state.terminalSessionMeta.set('alive-sess', {
        scopeType: 'workspace',
        scopeLabel: 'test',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
      });

      const daemonWs = await connectDaemonRelay(port);

      // Daemon sync includes the alive session
      daemonWs.send(JSON.stringify({ t: 'sync', sessionIds: ['alive-sess'] }));

      // Give sync time to process
      await new Promise((r) => setTimeout(r, 100));

      // Meta should still be there
      expect(state.terminalSessionMeta.has('alive-sess')).toBe(true);
    });

    it('should send error when browser reconnects but daemon is not ready', async () => {
      // Pre-populate meta so isReconnect=true
      state.terminalSessionMeta.set('orphan-sess', {
        scopeType: 'workspace',
        scopeLabel: 'test',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
      });

      // Connect browser WITHOUT daemon — should get error
      const messages: string[] = [];
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=orphan-sess&workingDir=/tmp`,
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

    it('should retain session meta when browser reconnects while relay daemon is down', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, { sessionId: 'meta-retain-sess', workingDir: '/tmp' });
      await spawnPromise;

      expect(state.terminalSessionMeta.has('meta-retain-sess')).toBe(true);

      // Disconnect the relay daemon
      daemonWs.close();
      await vi.waitFor(() => expect(state.terminalDaemon).toBeNull());

      // Browser reconnects while daemon is down — meta must be kept, not deleted
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=meta-retain-sess&workingDir=/tmp`,
        );
        openClients.push(ws);
        ws.on('message', (data) => resolve(data.toString()));
      });

      const raw = await gotMessage;
      const msg = JSON.parse(raw);
      expect(msg).toEqual({ t: 'error', message: 'No daemon connected' });

      // Meta must still be there for the eventual daemon reconnect + sync
      expect(state.terminalSessionMeta.has('meta-retain-sess')).toBe(true);
    });
  });

  describe('[FR-TERMINAL-050] concurrent browser reconnects', () => {
    it('should deliver reconnected buffer to all concurrently-reconnecting browsers', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      // First browser establishes the session
      const browser1 = await connectBrowser(port, { sessionId: 'sess-conc', workingDir: '/tmp' });
      await spawnPromise;

      // Two more browsers reconnect concurrently — both should get the buffer
      const reconnect1Promise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, { sessionId: 'sess-conc', workingDir: '/tmp' });
      // Consume reconnect for browser2
      await reconnect1Promise;

      // browser3 reconnects before the daemon replies — second pending entry
      const reconnect2Promise = waitForMessage(daemonWs);
      const browser3 = await connectBrowser(port, { sessionId: 'sess-conc', workingDir: '/tmp' });
      await reconnect2Promise;

      // Daemon sends one reconnected reply — both browser2 and browser3 should receive it
      const buf2Promise = waitForMessage(browser2);
      const buf3Promise = waitForMessage(browser3);
      const reconnectedMsg = JSON.stringify({
        t: 'reconnected',
        sessionId: 'sess-conc',
        buffer: ['line1', 'line2'],
      });
      daemonWs.send(reconnectedMsg);

      expect(await buf2Promise).toBe(reconnectedMsg);
      expect(await buf3Promise).toBe(reconnectedMsg);

      browser1.close();
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

  describe('[FR-TERMINAL-120] concurrent connect during spawn', () => {
    it('should route concurrent connect through reconnect once in-flight spawn completes', async () => {
      const daemonWs = await connectDaemonRelay(port);

      // Simulate another connection's spawn still in flight for this sessionId
      let resolveSpawn!: () => void;
      state.spawningSessions.set(
        'sess-conc',
        new Promise<void>((r) => {
          resolveSpawn = r;
        }),
      );

      const daemonMessages: string[] = [];
      daemonWs.on('message', (data) => daemonMessages.push(data.toString()));

      await connectBrowser(port, { sessionId: 'sess-conc', workingDir: '/tmp' });

      // While the spawn is in flight, no second spawn (or premature reconnect) reaches the daemon
      await new Promise((r) => setTimeout(r, 50));
      expect(daemonMessages).toHaveLength(0);

      // Originating spawn completes: meta persisted, gate cleared, promise resolved
      state.terminalSessionMeta.set('sess-conc', {
        scopeType: 'workspace',
        scopeLabel: 'test',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
      });
      state.spawningSessions.delete('sess-conc');
      resolveSpawn();

      await vi.waitFor(() => {
        expect(daemonMessages).toHaveLength(1);
      });
      expect(JSON.parse(daemonMessages[0])).toEqual({ t: 'reconnect', sessionId: 'sess-conc' });
    });

    it('should clear the spawn gate after a successful spawn', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, { sessionId: 'sess-gate', workingDir: '/tmp' });
      await spawnPromise;

      await vi.waitFor(() => {
        expect(state.spawningSessions.has('sess-gate')).toBe(false);
      });
    });

    it('should clear the spawn gate when spawn fails (no daemon)', async () => {
      const gotMessage = new Promise<string>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws/terminal?sessionId=sess-gate-fail&workingDir=/tmp`,
        );
        openClients.push(ws);
        ws.on('message', (data) => resolve(data.toString()));
      });

      const raw = await gotMessage;
      expect(JSON.parse(raw)).toEqual({ t: 'error', message: 'No daemon connected' });
      expect(state.spawningSessions.has('sess-gate-fail')).toBe(false);
    });

    it('should fall through to a fresh spawn when the in-flight spawn was abandoned', async () => {
      const daemonWs = await connectDaemonRelay(port);

      // In-flight spawn that gets abandoned (e.g. Strict Mode double-mount torn
      // down mid-container-start): promise resolves but no meta is ever set
      let resolveSpawn!: () => void;
      state.spawningSessions.set(
        'sess-conc-fail',
        new Promise<void>((r) => {
          resolveSpawn = r;
        }),
      );

      const daemonMessages: string[] = [];
      daemonWs.on('message', (data) => daemonMessages.push(data.toString()));

      await connectBrowser(port, {
        sessionId: 'sess-conc-fail',
        workingDir: '/tmp',
      });

      state.spawningSessions.delete('sess-conc-fail');
      resolveSpawn();

      // The waiter must recover by spawning its own PTY, not error out
      await vi.waitFor(() => {
        expect(daemonMessages).toHaveLength(1);
      });
      expect(JSON.parse(daemonMessages[0])).toMatchObject({
        t: 'spawn',
        sessionId: 'sess-conc-fail',
        workingDir: '/tmp',
      });
      expect(state.terminalSessionMeta.has('sess-conc-fail')).toBe(true);
      expect(state.spawningSessions.has('sess-conc-fail')).toBe(false);
    });
  });

  describe('[FR-TERMINAL-060] multi-attach', () => {
    it('should broadcast output to all attached browsers', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, { sessionId: 'sess-ma', workingDir: '/tmp' });
      await spawnPromise;

      // Second browser connects (triggers reconnect path)
      const reconnectPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, { sessionId: 'sess-ma', workingDir: '/tmp' });
      await reconnectPromise;

      // Send output from daemon — should reach both browsers
      const output1Promise = waitForMessage(browser1);
      const output2Promise = waitForMessage(browser2);
      const outputMsg = JSON.stringify({ t: 'o', sessionId: 'sess-ma', d: 'hello\r\n' });
      daemonWs.send(outputMsg);

      expect(await output1Promise).toBe(outputMsg);
      expect(await output2Promise).toBe(outputMsg);
    });

    it('[FR-TERMINAL-050] should replay reconnect buffer only to the newly-connecting browser', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, { sessionId: 'sess-replay', workingDir: '/tmp' });
      await spawnPromise;

      const reconnectPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, { sessionId: 'sess-replay', workingDir: '/tmp' });
      await reconnectPromise;

      // Daemon sends reconnected buffer — only browser2 should get it
      const buffer2Promise = waitForMessage(browser2);
      const reconnectedMsg = JSON.stringify({
        t: 'reconnected',
        sessionId: 'sess-replay',
        buffer: ['line1', 'line2'],
      });
      daemonWs.send(reconnectedMsg);

      expect(await buffer2Promise).toBe(reconnectedMsg);

      // Verify browser1 did NOT receive it by sending output and checking that's the first msg
      const output1Promise = waitForMessage(browser1);
      const outputMsg = JSON.stringify({ t: 'o', sessionId: 'sess-replay', d: 'after\r\n' });
      daemonWs.send(outputMsg);

      expect(await output1Promise).toBe(outputMsg);
    });

    it('[FR-TERMINAL-070] should not remove session when one browser disconnects while another is connected', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, {
        sessionId: 'sess-partial',
        workingDir: '/tmp',
      });
      await spawnPromise;

      const reconnectPromise = waitForMessage(daemonWs);
      await connectBrowser(port, { sessionId: 'sess-partial', workingDir: '/tmp' });
      await reconnectPromise;

      // Close first browser
      browser1.close();
      await vi.waitFor(() => {
        const wsSet = state.terminalSessions.get('sess-partial');
        expect(wsSet?.size).toBe(1);
      });

      // Session and meta should still exist
      expect(state.terminalSessions.has('sess-partial')).toBe(true);
      expect(state.terminalSessionMeta.has('sess-partial')).toBe(true);
    });

    it('[FR-TERMINAL-070] should clean up session entry only when all browsers disconnect', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      const browser1 = await connectBrowser(port, { sessionId: 'sess-alloff', workingDir: '/tmp' });
      await spawnPromise;

      const reconnectPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, { sessionId: 'sess-alloff', workingDir: '/tmp' });
      await reconnectPromise;

      browser1.close();
      browser2.close();

      await vi.waitFor(() => {
        expect(state.terminalSessions.has('sess-alloff')).toBe(false);
      });

      // Meta should persist for session restoration
      expect(state.terminalSessionMeta.has('sess-alloff')).toBe(true);
    });

    it('[FR-TERMINAL-060] should forward input from any attached browser to daemon', async () => {
      const daemonWs = await connectDaemonRelay(port);
      const spawnPromise = waitForMessage(daemonWs);

      await connectBrowser(port, { sessionId: 'sess-input-ma', workingDir: '/tmp' });
      await spawnPromise;

      const reconnectPromise = waitForMessage(daemonWs);
      const browser2 = await connectBrowser(port, {
        sessionId: 'sess-input-ma',
        workingDir: '/tmp',
      });
      await reconnectPromise;

      // Input from second browser reaches daemon
      const inputPromise = waitForMessage(daemonWs);
      const inputMsg = JSON.stringify({ t: 'i', sessionId: 'sess-input-ma', d: 'from-browser2\r' });
      browser2.send(inputMsg);

      expect(await inputPromise).toBe(inputMsg);
    });
  });
});
