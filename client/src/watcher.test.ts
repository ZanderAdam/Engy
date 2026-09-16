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

// Polling detection can miss a single write — a coarse mtime, or a starved
// event loop under parallel test load, and the tick sees nothing. Retrying the
// stimulus until the change is observed removes the dependency on one poll
// landing. `mutate` returns the path to touch for a given attempt: rewriting
// one file yields `change`, while a fresh name each time yields `add`.
async function retryUntilDetected(
  mutate: (attempt: number) => string,
  detected: () => boolean,
  timeout = 12_000,
): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeout) {
    fs.writeFileSync(mutate(attempt++), `data-${Date.now()}`);
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      if (detected()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('Timeout waiting for the watcher to report a change');
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

  it('[FR-FILES-190] should send FILE_CHANGE when a subscribed FILE is changed', async () => {
    const subscribedFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(subscribedFile, 'initial');

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedFile] }]);
    await watcher.waitForReady('test-ws');

    await retryUntilDetected(
      () => subscribedFile,
      () => wsClient.sent.length > 0,
    );

    expect(wsClient.sent.length).toBeGreaterThan(0);
    const msg = wsClient.sent[0] as {
      type: string;
      payload: { workspaceSlug: string; path: string; eventType: string };
    };
    expect(msg.type).toBe('FILE_CHANGE');
    expect(msg.payload.workspaceSlug).toBe('test-ws');
    expect(msg.payload.path).toBe(subscribedFile);
    expect(msg.payload.eventType).toBe('change');

    await watcher.closeAll();
  }, 40_000);

  it('[FR-FILES-190] should send FILE_CHANGE when a new file is created inside a subscribed DIRECTORY', async () => {
    const subscribedDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(subscribedDir, { recursive: true });

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedDir] }]);
    await watcher.waitForReady('test-ws');

    await retryUntilDetected(
      (n) => path.join(subscribedDir, `created-${n}.md`),
      () => wsClient.sent.length > 0,
    );

    expect(wsClient.sent.length).toBeGreaterThan(0);
    const msg = wsClient.sent[0] as {
      type: string;
      payload: { workspaceSlug: string; eventType: string };
    };
    expect(msg.type).toBe('FILE_CHANGE');
    expect(msg.payload.workspaceSlug).toBe('test-ws');
    expect(msg.payload.eventType).toBe('add');

    await watcher.closeAll();
  }, 40_000);

  it('[FR-FILES-190] should NOT send FILE_CHANGE for an unsubscribed sibling file', async () => {
    const subscribedFile = path.join(tmpDir, 'subscribed.md');
    const siblingFile = path.join(tmpDir, 'sibling.md');
    fs.writeFileSync(subscribedFile, 'initial');
    fs.writeFileSync(siblingFile, 'initial');

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedFile] }]);
    await watcher.waitForReady('test-ws');

    fs.writeFileSync(siblingFile, 'changed');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);

  it('[FR-FILES-190] sync with a changed path set: old path stops emitting, new path starts', async () => {
    const oldFile = path.join(tmpDir, 'old.md');
    const newFile = path.join(tmpDir, 'new.md');
    fs.writeFileSync(oldFile, 'initial');
    fs.writeFileSync(newFile, 'initial');

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [oldFile] }]);
    await watcher.waitForReady('test-ws');

    // Confirm old path emits before re-sync
    await retryUntilDetected(
      () => oldFile,
      () => wsClient.sent.length > 0,
    );
    expect(wsClient.sent.length).toBeGreaterThan(0);
    wsClient.sent.length = 0;

    // Re-sync to new path
    watcher.sync([{ slug: 'test-ws', paths: [newFile] }]);
    await watcher.waitForReady('test-ws');

    // Write to the new file — should emit
    const msgs = wsClient.sent as Array<{ payload: { path: string } }>;
    await retryUntilDetected(
      () => newFile,
      () => msgs.some((m) => m.payload.path === newFile),
    );
    expect(msgs.some((m) => m.payload.path === newFile)).toBe(true);

    // Write to old file — should NOT emit
    wsClient.sent.length = 0;
    fs.writeFileSync(oldFile, 'updated-again');
    await new Promise((r) => setTimeout(r, 500));
    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 40_000);

  it('[FR-FILES-190] sync with workspace absent or empty paths stops all emission', async () => {
    const subscribedDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(subscribedDir, { recursive: true });

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedDir] }]);
    await watcher.waitForReady('test-ws');

    // Remove workspace from sync
    watcher.sync([]);
    await new Promise((r) => setTimeout(r, 200));

    fs.writeFileSync(path.join(subscribedDir, 'late.md'), 'data');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);

  it('[FR-FILES-190] sync with empty paths array for a workspace stops emission', async () => {
    const subscribedDir = path.join(tmpDir, 'docs2');
    fs.mkdirSync(subscribedDir, { recursive: true });

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedDir] }]);
    await watcher.waitForReady('test-ws');

    // Sync same workspace with empty paths
    watcher.sync([{ slug: 'test-ws', paths: [] }]);
    await new Promise((r) => setTimeout(r, 200));

    fs.writeFileSync(path.join(subscribedDir, 'late.md'), 'data');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);

  it('[FR-FILES-190] should NOT send FILE_CHANGE for a dotfile inside a subscribed directory', async () => {
    const subscribedDir = path.join(tmpDir, 'docs3');
    fs.mkdirSync(subscribedDir, { recursive: true });

    const watcher = new SpecWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    watcher.sync([{ slug: 'test-ws', paths: [subscribedDir] }]);
    await watcher.waitForReady('test-ws');

    fs.writeFileSync(path.join(subscribedDir, '.hidden'), 'ignored');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);
});
