import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces, prs, agentSessions, taskGroups, projects } from '../../db/schema';
import { upsertPrs } from './pr';
import type { GhPr, GhAuthStatus } from '@engy/common';
import { eq } from 'drizzle-orm';

// ── Fixtures ─────────────────────────────────────────────────────────

function makePr(overrides: Partial<GhPr> = {}): GhPr {
  return {
    number: 1,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/1',
    headBranch: 'feat/my-feature',
    author: 'alice',
    isDraft: false,
    state: 'open',
    reviewDecision: null,
    ciStatus: 'passing',
    checks: [],
    ...overrides,
  };
}

// ── Daemon stub ───────────────────────────────────────────────────────

interface DaemonScripts {
  authStatus?: GhAuthStatus | Error;
  prsByRepo?: Map<string, GhPr[] | Error>;
}

interface DaemonMessage {
  type: string;
  payload: { requestId: string } & Record<string, unknown>;
}

function installFakeDaemon(ctx: TestContext, scripts: DaemonScripts) {
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      const requestId = msg.payload.requestId;

      queueMicrotask(() => {
        if (msg.type === 'GH_AUTH_STATUS_REQUEST') {
          const pending = ctx.state.pendingGhAuthStatus.get(requestId);
          if (!pending) return;
          ctx.state.pendingGhAuthStatus.delete(requestId);

          const auth = scripts.authStatus ?? { ok: true as const };
          if (auth instanceof Error) {
            pending.reject(auth);
          } else {
            pending.resolve({ status: auth });
          }
        } else if (msg.type === 'GH_PR_LIST_REQUEST') {
          const pending = ctx.state.pendingGhPrList.get(requestId);
          if (!pending) return;
          ctx.state.pendingGhPrList.delete(requestId);

          const result = scripts.prsByRepo?.get(msg.payload.repoDir as string);
          if (result instanceof Error) {
            pending.reject(result);
          } else {
            pending.resolve({ prs: result ?? [] });
          }
        }
      });
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
}

// ── Helpers ───────────────────────────────────────────────────────────

function seedWorkspace(ctx: TestContext, repos: string[]) {
  ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos }).run();
  return ctx.db.select().from(workspaces).where(eq(workspaces.slug, 'ws')).get()!;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('pr router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('upsertPrs', () => {
    it('should insert new PRs and report them as new changes', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      void ws;

      const pr1 = makePr({ number: 1, headBranch: 'feat/one' });
      const pr2 = makePr({ number: 2, headBranch: 'feat/two', ciStatus: 'pending' });

      const result = upsertPrs(ctx.db, '/repo-a', [pr1, pr2]);

      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.closed).toBe(0);
      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toMatchObject({ type: 'new', number: 1, current: 'open' });
      expect(result.changes[1]).toMatchObject({ type: 'new', number: 2, current: 'open' });

      const rows = ctx.db.select().from(prs).where(eq(prs.repo, '/repo-a')).all();
      expect(rows).toHaveLength(2);
    });

    it('should update existing PR in-place when ciStatus changes and report material change', () => {
      seedWorkspace(ctx, ['/repo-a']);

      // Initial insert
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 10, ciStatus: 'pending' })]);

      // Second call with changed ciStatus
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 10, ciStatus: 'passing' })]);

      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'ciStatus',
        number: 10,
        previous: 'pending',
        current: 'passing',
      });
    });

    it('should report state change when a PR transitions from open to merged', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 5, state: 'open' })]);
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 5, state: 'merged' })]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({ type: 'state', previous: 'open', current: 'merged' });
    });

    it('should report reviewDecision change', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 3, reviewDecision: null })]);
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 3, reviewDecision: 'APPROVED' })]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'reviewDecision',
        number: 3,
        previous: null,
        current: 'APPROVED',
      });
    });

    it('should close previously-open PRs not present in the fresh list', () => {
      seedWorkspace(ctx, ['/repo-a']);

      // Insert PRs 1 and 2
      upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 1 }),
        makePr({ number: 2 }),
      ]);

      // Second call only includes PR 1 — PR 2 should be closed
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      expect(result.closed).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'state',
        number: 2,
        previous: 'open',
        current: 'closed',
      });

      const closed = ctx.db.select().from(prs).where(eq(prs.number, 2)).get();
      expect(closed?.state).toBe('closed');
    });

    it('should not re-close already-closed PRs when they remain absent', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 }), makePr({ number: 2 })]);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      // Third call — PR 2 is still absent but already closed
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      expect(result.closed).toBe(0);
      expect(result.changes).toHaveLength(0);
    });

    it('should report no changes when nothing changed', () => {
      seedWorkspace(ctx, ['/repo-a']);

      const pr = makePr({ number: 42, ciStatus: 'passing', reviewDecision: null });
      upsertPrs(ctx.db, '/repo-a', [pr]);

      const result = upsertPrs(ctx.db, '/repo-a', [pr]);
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.changes).toHaveLength(0);
    });

    it('should normalize uppercase state values to lowercase', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 7, state: 'OPEN' })]);

      const row = ctx.db.select().from(prs).where(eq(prs.number, 7)).get();
      expect(row?.state).toBe('open');
    });
  });

  describe('list', () => {
    it('should return open PRs for all workspace repos ordered by updatedAt desc', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/a' })]);
      upsertPrs(ctx.db, '/repo-b', [makePr({ number: 2, headBranch: 'feat/b' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });

      expect(result).toHaveLength(2);
      const branches = result.map((r) => r.headBranch);
      expect(branches).toContain('feat/a');
      expect(branches).toContain('feat/b');
    });

    it('should not return closed or merged PRs', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 1, state: 'open' }),
        makePr({ number: 2, state: 'closed' }),
        makePr({ number: 3, state: 'merged' }),
      ]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
    });

    it('should correlate PRs with most recent agent session matching headBranch', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      // Insert project + task group for the session
      ctx.db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'P', slug: 'p', projectDir: '/repo-a' })
        .run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db
        .insert(taskGroups)
        .values({ projectId: proj.id, name: 'TG', numInMilestone: 0 })
        .run();
      const tg = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, proj.id)).get()!;

      // Two sessions on the same branch — the later one should win
      ctx.db
        .insert(agentSessions)
        .values([
          {
            sessionId: 'sess-old',
            taskGroupId: tg.id,
            branch: 'feat/my-feature',
            worktreePath: '/old-wt',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            sessionId: 'sess-new',
            taskGroupId: tg.id,
            branch: 'feat/my-feature',
            worktreePath: '/new-wt',
            createdAt: '2024-02-01T00:00:00.000Z',
            updatedAt: '2024-02-01T00:00:00.000Z',
          },
        ])
        .run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/my-feature' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('sess-new');
      expect(result[0].taskGroupId).toBe(tg.id);
      expect(result[0].worktreePath).toBe('/new-wt');
    });

    it('should return null session fields when no matching agent session exists', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/no-session' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result[0].sessionId).toBeNull();
      expect(result[0].taskGroupId).toBeNull();
      expect(result[0].worktreePath).toBeNull();
    });

    it('should return empty array when workspace has no repos', async () => {
      const ws = seedWorkspace(ctx, []);
      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result).toEqual([]);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(caller.pr.list({ workspaceId: 999 })).rejects.toThrow('Workspace not found');
    });
  });

  describe('refresh', () => {
    it('should fetch PRs for each repo and upsert them', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);

      installFakeDaemon(ctx, {
        authStatus: { ok: true },
        prsByRepo: new Map([
          ['/repo-a', [makePr({ number: 1 })]],
          ['/repo-b', [makePr({ number: 2, headBranch: 'feat/b' })]],
        ]),
      });

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);

      const stored = ctx.db.select().from(prs).all();
      expect(stored).toHaveLength(2);
    });

    it('should return gh-not-installed error when gh CLI is not installed', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      installFakeDaemon(ctx, {
        authStatus: { ok: false, reason: 'not-installed' },
      });

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('gh-not-installed');
    });

    it('should return gh-not-authenticated error when not logged in', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      installFakeDaemon(ctx, {
        authStatus: { ok: false, reason: 'not-authenticated' },
      });

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('gh-not-authenticated');
    });

    it('should return error message when dispatch throws', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      installFakeDaemon(ctx, {
        authStatus: new Error('daemon died'),
      });

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('daemon died');
    });

    it('should return empty results when workspace has no repos', async () => {
      const ws = seedWorkspace(ctx, []);

      const results = await caller.pr.refresh({ workspaceId: ws.id });
      expect(results).toEqual([]);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(caller.pr.refresh({ workspaceId: 999 })).rejects.toThrow('Workspace not found');
    });
  });
});
