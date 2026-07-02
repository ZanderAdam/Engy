import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces, prs as prsTable } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { GhPr } from '@engy/common';
import { runPollCycle, startPrPoller, stopPrPoller, POLL_INTERVAL_MS } from './poller';
import * as broadcast from '../ws/broadcast';

// ── Fake daemon ────────────────────────────────────────────────────────

interface DaemonMessage {
  type: string;
  payload: { requestId: string; repoDir: string; prNumber?: number };
}

type FailedLogsResponse = Array<{ checkName: string; excerpt: string }> | Error;

function installFakeDaemon(
  ctx: TestContext,
  prsByRepo: Map<string, GhPr[] | Error>,
  failedLogsByRepo?: Map<string, FailedLogsResponse>,
): void {
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      const { requestId, repoDir } = msg.payload;

      queueMicrotask(() => {
        if (msg.type === 'GH_PR_LIST_REQUEST') {
          const pending = ctx.state.pendingGhPrList.get(requestId);
          if (!pending) return;
          ctx.state.pendingGhPrList.delete(requestId);

          const result = prsByRepo.get(repoDir);
          if (result instanceof Error) {
            pending.reject(result);
          } else {
            pending.resolve({ prs: result ?? [] });
          }
          return;
        }

        if (msg.type === 'GH_PR_FAILED_LOGS_REQUEST') {
          const pending = ctx.state.pendingGhPrFailedLogs.get(requestId);
          if (!pending) return;
          ctx.state.pendingGhPrFailedLogs.delete(requestId);

          const result = failedLogsByRepo?.get(repoDir);
          if (result instanceof Error) {
            pending.reject(result);
          } else {
            pending.resolve({ logs: result ?? [] });
          }
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
    headSha: 'abc123',
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

      const rows = ctx.db.select().from(prsTable).all();
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

    it('should persist headSha into the prs table', async () => {
      seedWorkspace(ctx, ['/repo-a']);
      installFakeDaemon(
        ctx,
        new Map<string, GhPr[] | Error>([['/repo-a', [makePr({ headSha: 'deadbeef' })]]]),
      );

      await runPollCycle(ctx.state, ctx.db);

      const row = ctx.db.select().from(prsTable).where(eq(prsTable.repo, '/repo-a')).get();
      expect(row?.headSha).toBe('deadbeef');
    });

    describe('CI failure transition handling', () => {
      it('should set lastFailedHeadSha when a PR transitions to failing', async () => {
        seedWorkspace(ctx, ['/repo-a']);

        // First cycle: PR inserted as passing
        installFakeDaemon(
          ctx,
          new Map<string, GhPr[] | Error>([
            ['/repo-a', [makePr({ number: 1, ciStatus: 'passing', headSha: 'sha1' })]],
          ]),
        );
        await runPollCycle(ctx.state, ctx.db);

        // Second cycle: PR transitions to failing — triggers failed log fetch
        installFakeDaemon(
          ctx,
          new Map<string, GhPr[] | Error>([
            ['/repo-a', [makePr({ number: 1, ciStatus: 'failing', headSha: 'sha2' })]],
          ]),
          new Map([['/repo-a', []]]),
        );
        await runPollCycle(ctx.state, ctx.db);

        // Wait for the async handleFailingPr to settle
        await new Promise((r) => queueMicrotask(r as () => void));

        const row = ctx.db
          .select()
          .from(prsTable)
          .where(and(eq(prsTable.repo, '/repo-a'), eq(prsTable.number, 1)))
          .get();
        expect(row?.lastFailedHeadSha).toBe('sha2');
      });

      it('should reset autoFixAttempts to 0 when headSha changes on a new failure', async () => {
        seedWorkspace(ctx, ['/repo-a']);

        // Seed a PR directly with a prior failing state so we can check reset
        const pr = makePr({ number: 1, ciStatus: 'passing', headSha: 'sha1' });
        installFakeDaemon(ctx, new Map([['/repo-a', [pr]]]), new Map([['/repo-a', []]]));
        await runPollCycle(ctx.state, ctx.db);

        // Manually set lastFailedHeadSha to simulate a prior failure on different SHA
        ctx.db
          .update(prsTable)
          .set({ lastFailedHeadSha: 'sha-old', autoFixAttempts: 3 })
          .where(and(eq(prsTable.repo, '/repo-a'), eq(prsTable.number, 1)))
          .run();

        // Now PR fails with a new SHA
        installFakeDaemon(
          ctx,
          new Map([['/repo-a', [makePr({ number: 1, ciStatus: 'failing', headSha: 'sha2' })]]]),
          new Map([['/repo-a', []]]),
        );
        await runPollCycle(ctx.state, ctx.db);
        await new Promise((r) => queueMicrotask(r as () => void));

        const row = ctx.db
          .select()
          .from(prsTable)
          .where(and(eq(prsTable.repo, '/repo-a'), eq(prsTable.number, 1)))
          .get();
        expect(row?.autoFixAttempts).toBe(0);
        expect(row?.lastFailedHeadSha).toBe('sha2');
      });

      it('should not reset autoFixAttempts when headSha is the same as lastFailedHeadSha', async () => {
        seedWorkspace(ctx, ['/repo-a']);

        const pr = makePr({ number: 1, ciStatus: 'passing', headSha: 'sha1' });
        installFakeDaemon(ctx, new Map([['/repo-a', [pr]]]), new Map([['/repo-a', []]]));
        await runPollCycle(ctx.state, ctx.db);

        // Set lastFailedHeadSha to the same SHA
        ctx.db
          .update(prsTable)
          .set({ lastFailedHeadSha: 'sha1', autoFixAttempts: 2 })
          .where(and(eq(prsTable.repo, '/repo-a'), eq(prsTable.number, 1)))
          .run();

        // PR fails with the same SHA
        installFakeDaemon(
          ctx,
          new Map([['/repo-a', [makePr({ number: 1, ciStatus: 'failing', headSha: 'sha1' })]]]),
          new Map([['/repo-a', []]]),
        );
        await runPollCycle(ctx.state, ctx.db);
        await new Promise((r) => queueMicrotask(r as () => void));

        const row = ctx.db
          .select()
          .from(prsTable)
          .where(and(eq(prsTable.repo, '/repo-a'), eq(prsTable.number, 1)))
          .get();
        expect(row?.autoFixAttempts).toBe(2);
      });

      it('should continue gracefully when failed log dispatch errors', async () => {
        seedWorkspace(ctx, ['/repo-a']);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        installFakeDaemon(
          ctx,
          new Map([['/repo-a', [makePr({ number: 1, ciStatus: 'passing', headSha: 'sha1' })]]]));
        await runPollCycle(ctx.state, ctx.db);

        installFakeDaemon(
          ctx,
          new Map([['/repo-a', [makePr({ number: 1, ciStatus: 'failing', headSha: 'sha2' })]]]),
          new Map([['/repo-a', new Error('log fetch failed')]]),
        );
        await runPollCycle(ctx.state, ctx.db);
        await new Promise((r) => queueMicrotask(r as () => void));

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('/repo-a#1'),
          expect.stringContaining('log fetch failed'),
        );
        errorSpy.mockRestore();
      });
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

    it('should not start a new cycle while the previous one is still in progress', async () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      seedWorkspace(ctx, ['/repo-a']);

      let dispatchCount = 0;
      // Daemon that counts dispatches but never responds — first cycle hangs indefinitely.
      const mock = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (raw: string) => {
          const msg = JSON.parse(raw) as DaemonMessage;
          if (msg.type === 'GH_PR_LIST_REQUEST') {
            dispatchCount++;
            // Intentionally no response — the pending promise never resolves.
          }
        },
      };
      ctx.state.daemon = mock as unknown as WebSocket;

      startPrPoller(ctx.state, ctx.db);

      // First cycle fires and hangs (or times out after the dispatch timeout window).
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(dispatchCount).toBe(1);

      // Advancing by another full interval must NOT start a second cycle because
      // the self-scheduling timer is only set after the current cycle finishes.
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(dispatchCount).toBe(1);

      consoleSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
