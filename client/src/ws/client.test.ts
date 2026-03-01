import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { WsClient, computeBackoff, deriveWsUrl } from './client.js';
import type { WorkspacesSyncMessage, ValidatePathsRequestMessage } from '@engy/common';
import { access } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

const mockedAccess = vi.mocked(access);

describe('deriveWsUrl', () => {
  it('converts http to ws', () => {
    expect(deriveWsUrl('http://localhost:3000')).toBe('ws://localhost:3000');
  });

  it('converts https to wss', () => {
    expect(deriveWsUrl('https://example.com')).toBe('wss://example.com');
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
