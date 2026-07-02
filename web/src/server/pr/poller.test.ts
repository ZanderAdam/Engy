import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';
import type { GhPr } from '@engy/common';
import { runPollCycle, startPrPoller, stopPrPoller, POLL_INTERVAL_MS } from './poller';
import * as broadcast from '../ws/broadcast';

// ── Fake daemon ────────────────────────────────────────────────────────

interface DaemonMessage {
  type: string;
  payload: { requestId: string; repoDir: string };
}

function installFakeDaemon(ctx: TestContext, prsByRepo: Map<string, GhPr[] | Error>): void {
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      const { requestId, repoDir } = msg.payload;

      queueMicrotask(() => {
        if (msg.type !== 'GH_PR_LIST_REQUEST') return;

        const pending = ctx.state.pendingGhPrList.get(requestId);
        if (!pending) return;
        ctx.state.pendingGhPrList.delete(requestId);

        const result = prsByRepo.get(repoDir);
        if (result instanceof Error) {
          pending.reject(result);
        } else {
          pending.resolve({ prs: result ?? [] });
        }
      });
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
}

// ── Fixtures ───────────────────────────────────────────────────────────

function makePr(overrides: Partial<GhPr> = {}): GhPr {
  return {
    number: 1,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/1',
    headBranch: 'feat/one',
    author: 'alice',
    isDraft: false,
    state: 'open',
    reviewDecision: null,
    ciStatus: 'passing',
    checks: [],
    ...overrides,
  };
}

function seedWorkspace(ctx: TestContext, repos: string[]): void {
  ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos }).run();
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('PR poller', () => {
  let ctx: TestContext;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = setupTestDb();
    broadcastSpy = vi.spyOn(broadcast, 'broadcastPrChange').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stopPrPoller(ctx.state);
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  describe('runPollCycle', () => {
    it('should skip the cycle when no daemon is connected', async () => {
      seedWorkspace(ctx, ['/repo-a']);
      ctx.state.daemon = null;

      await runPollCycle(ctx.state, ctx.db);

      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('should poll each repo and upsert PRs into the database', async () => {
      seedWorkspace(ctx, ['/repo-a', '/repo-b']);
      const pr1 = makePr({ number: 1 });
      const pr2 = makePr({ number: 2 });
      installFakeDaemon(
        ctx,
        new Map<string, GhPr[] | Error>([
          ['/repo-a', [pr1]],
          ['/repo-b', [pr2]],
        ]),
      );

      await runPollCycle(ctx.state, ctx.db);

      const { prs: prTable } = await import('../db/schema');
      const rows = ctx.db.select().from(prTable).all();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.repo).sort()).toEqual(['/repo-a', '/repo-b']);
    });

    it('should broadcast on material change', async () => {
      const ws = ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos: ['/repo-a'] }).returning().get();
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', [makePr({ number: 1 })]]]));

      await runPollCycle(ctx.state, ctx.db);

      expect(broadcastSpy).toHaveBeenCalledOnce();
      expect(broadcastSpy).toHaveBeenCalledWith(ws.id, '/repo-a');
    });

    it('should not broadcast when PRs have not changed', async () => {
      seedWorkspace(ctx, ['/repo-a']);
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', [makePr({ number: 1 })]]]));

      // First cycle inserts — material change → broadcast
      await runPollCycle(ctx.state, ctx.db);
      broadcastSpy.mockClear();

      // Second cycle with identical PRs — no changes → no broadcast
      await runPollCycle(ctx.state, ctx.db);

      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('should continue polling remaining repos when one repo errors', async () => {
      seedWorkspace(ctx, ['/repo-err', '/repo-ok']);
      installFakeDaemon(
        ctx,
        new Map<string, GhPr[] | Error>([
          ['/repo-err', new Error('gh not installed')],
          ['/repo-ok', [makePr({ number: 99 })]],
        ]),
      );

      await runPollCycle(ctx.state, ctx.db);

      expect(broadcastSpy).toHaveBeenCalledOnce();
      expect(broadcastSpy).toHaveBeenCalledWith(expect.any(Number), '/repo-ok');
    });

    it('should log an error for a failing repo only once across multiple cycles', async () => {
      seedWorkspace(ctx, ['/repo-err']);
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-err', new Error('auth failure')]]));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await runPollCycle(ctx.state, ctx.db);
      await runPollCycle(ctx.state, ctx.db);

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toContain('/repo-err');

      errorSpy.mockRestore();
    });

    it('should log again after a failing repo recovers and then fails again', async () => {
      seedWorkspace(ctx, ['/repo-a']);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      // First cycle: error
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', new Error('fail')]]));
      await runPollCycle(ctx.state, ctx.db);
      expect(errorSpy).toHaveBeenCalledOnce();
      errorSpy.mockClear();

      // Second cycle: success (recovers → clears flag)
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', [makePr()]]]));
      await runPollCycle(ctx.state, ctx.db);
      expect(errorSpy).not.toHaveBeenCalled();

      // Third cycle: error again (flag was cleared → logs again)
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', new Error('fail again')]]));
      await runPollCycle(ctx.state, ctx.db);
      expect(errorSpy).toHaveBeenCalledOnce();

      errorSpy.mockRestore();
    });
  });

  describe('startPrPoller / stopPrPoller', () => {
    it('should set a timer on state when started', () => {
      startPrPoller(ctx.state, ctx.db);

      expect(ctx.state.prPollerTimer).not.toBeNull();
    });

    it('should clear the timer when stopped', () => {
      startPrPoller(ctx.state, ctx.db);
      stopPrPoller(ctx.state);

      expect(ctx.state.prPollerTimer).toBeNull();
    });

    it('should not start a second timer if already running', () => {
      startPrPoller(ctx.state, ctx.db);
      const firstTimer = ctx.state.prPollerTimer;
      startPrPoller(ctx.state, ctx.db);

      expect(ctx.state.prPollerTimer).toBe(firstTimer);
    });

    it('should fire the poll cycle on the configured interval', async () => {
      vi.useFakeTimers();
      seedWorkspace(ctx, ['/repo-a']);
      installFakeDaemon(ctx, new Map<string, GhPr[] | Error>([['/repo-a', [makePr()]]]));

      startPrPoller(ctx.state, ctx.db);
      expect(broadcastSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(broadcastSpy).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });
  });
});
