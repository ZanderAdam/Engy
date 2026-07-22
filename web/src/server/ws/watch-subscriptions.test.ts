import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  handleWatchSubscribe,
  dropWatchSocket,
  computeWatchUnion,
  sendWatchPathsSync,
  WATCH_SYNC_DEBOUNCE_MS,
} from './watch-subscriptions';
import { createAppState, resetAppState, type AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';

function makeFakeSocket(): WebSocket {
  return { readyState: WebSocket.OPEN } as unknown as WebSocket;
}

function makeFakeDaemon(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (msg: string) => sent.push(msg),
  } as unknown as WebSocket;
  return { ws, sent };
}

describe('watch-subscriptions', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = setupTestDb();
    state = ctx.state;
  });

  afterEach(() => {
    if (state.watchSyncTimer !== null) {
      clearTimeout(state.watchSyncTimer);
      state.watchSyncTimer = null;
    }
    vi.useRealTimers();
    ctx.cleanup();
  });

  describe('computeWatchUnion', () => {
    it('should return empty array when no subscriptions exist', () => {
      expect(computeWatchUnion(state)).toEqual([]);
    });

    it('should union paths across multiple sockets for same workspace', () => {
      const ws1 = makeFakeSocket();
      const ws2 = makeFakeSocket();
      const docsDir = ctx.tmpDir;

      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      state.watchSubscriptions.set(
        ws1,
        new Map([['ws', new Set([`${docsDir}/a.md`])]]),
      );
      state.watchSubscriptions.set(
        ws2,
        new Map([['ws', new Set([`${docsDir}/b.md`, `${docsDir}/a.md`])]]),
      );

      const union = computeWatchUnion(state);
      expect(union).toHaveLength(1);
      expect(union[0].slug).toBe('ws');
      expect(union[0].paths).toEqual([`${docsDir}/a.md`, `${docsDir}/b.md`]);
    });

    it('should return slugs sorted alphabetically', () => {
      const ws1 = makeFakeSocket();
      const docsDir = ctx.tmpDir;

      ctx.db.insert(workspaces).values({ name: 'Z WS', slug: 'z-ws', docsDir }).run();
      ctx.db.insert(workspaces).values({ name: 'A WS', slug: 'a-ws', docsDir }).run();

      state.watchSubscriptions.set(
        ws1,
        new Map([
          ['z-ws', new Set([`${docsDir}/z.md`])],
          ['a-ws', new Set([`${docsDir}/a.md`])],
        ]),
      );

      const union = computeWatchUnion(state);
      expect(union[0].slug).toBe('a-ws');
      expect(union[1].slug).toBe('z-ws');
    });

    it('should return paths sorted within each workspace', () => {
      const ws1 = makeFakeSocket();
      const docsDir = ctx.tmpDir;

      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      state.watchSubscriptions.set(
        ws1,
        new Map([['ws', new Set([`${docsDir}/z.md`, `${docsDir}/a.md`, `${docsDir}/m.md`])]]),
      );

      const union = computeWatchUnion(state);
      expect(union[0].paths).toEqual([
        `${docsDir}/a.md`,
        `${docsDir}/m.md`,
        `${docsDir}/z.md`,
      ]);
    });
  });

  describe('handleWatchSubscribe', () => {
    it('[FR-WS-190] should store valid subscriptions on the socket', () => {
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'ws', paths: [`${docsDir}/file.md`] }],
      });

      const subs = state.watchSubscriptions.get(ws);
      expect(subs).toBeDefined();
      expect(subs!.get('ws')?.has(`${docsDir}/file.md`)).toBe(true);
    });

    it('[FR-WS-190] should replace existing subscriptions on second call from same socket', () => {
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'ws', paths: [`${docsDir}/first.md`] }],
      });
      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'ws', paths: [`${docsDir}/second.md`] }],
      });

      const subs = state.watchSubscriptions.get(ws);
      expect(subs!.get('ws')?.has(`${docsDir}/first.md`)).toBe(false);
      expect(subs!.get('ws')?.has(`${docsDir}/second.md`)).toBe(true);
    });

    it('[FR-WS-190] should silently drop paths that are relative (not absolute)', () => {
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'ws', paths: ['relative/path.md'] }],
      });

      const subs = state.watchSubscriptions.get(ws);
      expect(subs?.get('ws')).toBeUndefined();
    });

    it('[FR-WS-190] should silently drop paths with .. traversal segments', () => {
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      handleWatchSubscribe(state, ws, {
        subscriptions: [
          {
            workspaceSlug: 'ws',
            paths: [`${docsDir}/../etc/passwd`],
          },
        ],
      });

      const subs = state.watchSubscriptions.get(ws);
      expect(subs?.get('ws')).toBeUndefined();
    });

    it('[FR-WS-190] should silently drop paths outside the workspace docsDir', () => {
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'ws', paths: ['/etc/passwd'] }],
      });

      const subs = state.watchSubscriptions.get(ws);
      expect(subs?.get('ws')).toBeUndefined();
    });

    it('[FR-WS-190] should silently drop unknown workspace slugs', () => {
      const ws = makeFakeSocket();

      handleWatchSubscribe(state, ws, {
        subscriptions: [{ workspaceSlug: 'unknown-ws', paths: ['/some/path.md'] }],
      });

      expect(state.watchSubscriptions.get(ws)).toBeDefined();
      expect(state.watchSubscriptions.get(ws)!.size).toBe(0);
    });

    it('should ignore malformed payload', () => {
      const ws = makeFakeSocket();

      handleWatchSubscribe(state, ws, null);
      handleWatchSubscribe(state, ws, 'string payload');
      handleWatchSubscribe(state, ws, { subscriptions: 'not an array' });

      expect(state.watchSubscriptions.get(ws)).toBeUndefined();
    });
  });

  describe('dropWatchSocket', () => {
    it('should remove the socket entry from subscriptions', () => {
      const ws = makeFakeSocket();
      state.watchSubscriptions.set(ws, new Map());

      dropWatchSocket(state, ws);

      expect(state.watchSubscriptions.has(ws)).toBe(false);
    });

    it('should recompute the union after socket drop (schedules sync)', () => {
      const ws = makeFakeSocket();
      state.watchSubscriptions.set(ws, new Map([['ws', new Set(['/some/path'])]]) );

      dropWatchSocket(state, ws);

      expect(state.watchSyncTimer).not.toBeNull();
    });
  });

  describe('sendWatchPathsSync', () => {
    it('should not send when daemon is not connected', () => {
      state.daemon = null;
      const ws = makeFakeSocket();
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      state.watchSubscriptions.set(
        ws,
        new Map([['ws', new Set([`${docsDir}/file.md`])]]),
      );

      sendWatchPathsSync(state);
      expect(state.lastSentWatchPaths).toBeNull();
    });

    it('[FR-WS-200] should send WATCH_PATHS_SYNC to daemon', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;

      sendWatchPathsSync(state);

      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('WATCH_PATHS_SYNC');
      expect(msg.payload.workspaces).toEqual([]);
    });

    it('[FR-WS-200] should send empty union and still deliver to daemon', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;

      sendWatchPathsSync(state);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]).payload.workspaces).toEqual([]);
    });

    it('[FR-WS-200] should skip sending when payload is identical to last sent', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;

      sendWatchPathsSync(state);
      sendWatchPathsSync(state);

      expect(sent).toHaveLength(1);
    });

    it('[FR-WS-200] should send when force=true even if payload is identical', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;

      sendWatchPathsSync(state);
      sendWatchPathsSync(state, { force: true });

      expect(sent).toHaveLength(2);
    });
  });

  describe('debounced sync', () => {
    it('[FR-WS-200] should debounce sends and only send once after WATCH_SYNC_DEBOUNCE_MS', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;
      const docsDir = ctx.tmpDir;
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', docsDir }).run();

      const ws1 = makeFakeSocket();
      const ws2 = makeFakeSocket();

      handleWatchSubscribe(state, ws1, {
        subscriptions: [{ workspaceSlug: 'ws', paths: [`${docsDir}/a.md`] }],
      });
      handleWatchSubscribe(state, ws2, {
        subscriptions: [{ workspaceSlug: 'ws', paths: [`${docsDir}/b.md`] }],
      });

      expect(sent).toHaveLength(0);

      vi.advanceTimersByTime(WATCH_SYNC_DEBOUNCE_MS);

      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.payload.workspaces[0].paths).toContain(`${docsDir}/a.md`);
      expect(msg.payload.workspaces[0].paths).toContain(`${docsDir}/b.md`);
    });

    it('should reset debounce timer on each subscribe call', () => {
      const { ws: daemonWs, sent } = makeFakeDaemon();
      state.daemon = daemonWs;

      const ws1 = makeFakeSocket();
      handleWatchSubscribe(state, ws1, { subscriptions: [] });
      vi.advanceTimersByTime(WATCH_SYNC_DEBOUNCE_MS - 50);

      handleWatchSubscribe(state, ws1, { subscriptions: [] });
      vi.advanceTimersByTime(50);

      expect(sent).toHaveLength(0);

      vi.advanceTimersByTime(WATCH_SYNC_DEBOUNCE_MS);
      expect(sent).toHaveLength(1);
    });
  });
});
