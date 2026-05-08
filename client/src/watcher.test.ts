import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpecWatcher } from './watcher';
import type { WsClient } from './ws/client';

function createMockWsClient() {
  const sent: unknown[] = [];
  return {
    send: vi.fn((msg: unknown) => sent.push(msg)),
    sent,
  } as unknown as WsClient & { sent: unknown[] };
}

function waitForFileChange(wsClient: WsClient & { sent: unknown[] }, timeout = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (wsClient.sent.length > 0) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for file change'));
      setTimeout(check, 50);
    };
    check();
  });
}

describe('SpecWatcher', { retry: 2 }, () => {
  let tmpDir: string;
  let wsClient: WsClient & { sent: unknown[] };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-watcher-test-'));
    wsClient = createMockWsClient();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should send FILE_CHANGE when a spec file changes', async () => {
    const specsDir = path.join(tmpDir, 'test-ws', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    const watcher = new SpecWatcher(tmpDir, wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws' }]);
    await watcher.waitForReady('test-ws');

    fs.writeFileSync(path.join(specsDir, 'test.md'), 'hello');

    await waitForFileChange(wsClient);

    expect(wsClient.sent.length).toBeGreaterThan(0);
    const msg = wsClient.sent[0] as { type: string; payload: { workspaceSlug: string; eventType: string } };
    expect(msg.type).toBe('FILE_CHANGE');
    expect(msg.payload.workspaceSlug).toBe('test-ws');
    expect(msg.payload.eventType).toBe('add');

    await watcher.closeAll();
  }, 15_000);

  it('should stop watching on workspace removal', async () => {
    const specsDir = path.join(tmpDir, 'ws-a', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    const watcher = new SpecWatcher(tmpDir, wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'ws-a' }]);
    await watcher.waitForReady('ws-a');

    watcher.sync([]);
    await new Promise((r) => setTimeout(r, 200));

    fs.writeFileSync(path.join(specsDir, 'late.md'), 'data');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);

  it('should start watchers for new workspaces on sync', async () => {
    const specsDirA = path.join(tmpDir, 'ws-a', 'specs');
    const specsDirB = path.join(tmpDir, 'ws-b', 'specs');
    fs.mkdirSync(specsDirA, { recursive: true });
    fs.mkdirSync(specsDirB, { recursive: true });

    const watcher = new SpecWatcher(tmpDir, wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'ws-a' }]);
    await watcher.waitForReady('ws-a');

    watcher.sync([{ slug: 'ws-a' }, { slug: 'ws-b' }]);
    await watcher.waitForReady('ws-b');

    fs.writeFileSync(path.join(specsDirB, 'new.md'), 'data');

    await waitForFileChange(wsClient);

    const msgs = wsClient.sent as Array<{ payload: { workspaceSlug: string } }>;
    const bMsgs = msgs.filter((m) => m.payload.workspaceSlug === 'ws-b');
    expect(bMsgs.length).toBeGreaterThan(0);

    await watcher.closeAll();
  }, 15_000);
});
