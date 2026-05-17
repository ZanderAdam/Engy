import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces, projects } from '../../db/schema';
import type { WorktreeAddErrorCode, WorktreeRemoveErrorCode } from '@engy/common';

interface DaemonMessage {
  type: string;
  payload: { requestId: string } & Record<string, unknown>;
}

interface FakeWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface DaemonScripts {
  /** repoDir → list of (branch, path) entries for GIT_WORKTREE_LIST_REQUEST */
  worktreeList?: Map<string, FakeWorktree[] | Error>;
  /** Per call (in order), what add does — success or {error, code} */
  addBehaviors?: Array<{ ok: true } | { ok: false; error: string; code: WorktreeAddErrorCode }>;
  /** Per call (in order), what remove does */
  removeBehaviors?: Array<
    { ok: true } | { ok: false; error: string; code: WorktreeRemoveErrorCode }
  >;
}

function installFakeDaemon(ctx: TestContext, scripts: DaemonScripts) {
  const sent: DaemonMessage[] = [];
  let addIdx = 0;
  let removeIdx = 0;

  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      sent.push(msg);

      const requestId = msg.payload.requestId;
      queueMicrotask(() => {
        if (msg.type === 'GIT_WORKTREE_LIST_REQUEST') {
          const pending = ctx.state.pendingGitWorktreeList.get(requestId);
          if (!pending) return;
          ctx.state.pendingGitWorktreeList.delete(requestId);
          const result = scripts.worktreeList?.get(msg.payload.repoDir as string);
          if (result instanceof Error) {
            pending.reject(result);
          } else {
            pending.resolve({
              worktrees: (result ?? []).map((w) => ({ ...w, isLocked: false })),
            });
          }
        } else if (msg.type === 'WORKTREE_ADD_REQUEST') {
          const pending = ctx.state.pendingWorktreeAdd.get(requestId);
          if (!pending) return;
          ctx.state.pendingWorktreeAdd.delete(requestId);
          const behavior = scripts.addBehaviors?.[addIdx++] ?? { ok: true };
          if (behavior.ok) {
            pending.resolve({
              worktreePath: msg.payload.worktreePath as string,
              branch: msg.payload.branch as string,
            });
          } else {
            const err = new Error(behavior.error) as Error & { code: WorktreeAddErrorCode };
            err.code = behavior.code;
            pending.reject(err);
          }
        } else if (msg.type === 'WORKTREE_REMOVE_REQUEST') {
          const pending = ctx.state.pendingWorktreeRemove.get(requestId);
          if (!pending) return;
          ctx.state.pendingWorktreeRemove.delete(requestId);
          const behavior = scripts.removeBehaviors?.[removeIdx++] ?? { ok: true };
          if (behavior.ok) {
            pending.resolve();
          } else {
            const err = new Error(behavior.error) as Error & { code: WorktreeRemoveErrorCode };
            err.code = behavior.code;
            pending.reject(err);
          }
        }
      });
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
  return { sent };
}

async function seed(ctx: TestContext, repos: string[]) {
  ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos }).run();
  const ws = ctx.db.select().from(workspaces).where(eqSlug('ws')).get()!;
  ctx.db
    .insert(projects)
    .values({ workspaceId: ws.id, name: 'Proj', slug: 'proj', projectDir: 'proj' })
    .run();
  const proj = ctx.db.select().from(projects).where(eqProjectSlug('proj')).get()!;
  return { ws, proj };
}

// Tiny helpers to keep test imports lean.
import { eq } from 'drizzle-orm';
function eqSlug(s: string) {
  return eq(workspaces.slug, s);
}
function eqProjectSlug(s: string) {
  return eq(projects.slug, s);
}

describe('worktree router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('listGrouped', () => {
    it('groups worktrees by branch across repos and excludes main', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B']);

      installFakeDaemon(ctx, {
        worktreeList: new Map([
          [
            '/repo-A',
            [
              { path: '/repo-A', branch: 'main', isMain: true },
              { path: '/wt/feat-x-A', branch: 'feat-x', isMain: false },
              { path: '/wt/feat-y-A', branch: 'feat-y', isMain: false },
            ],
          ],
          [
            '/repo-B',
            [
              { path: '/repo-B', branch: 'main', isMain: true },
              { path: '/wt/feat-x-B', branch: 'feat-x', isMain: false },
            ],
          ],
        ]),
      });

      const { groups, errors } = await caller.worktree.listGrouped({ projectId: proj.id });

      expect(errors).toHaveLength(0);
      expect(groups).toHaveLength(2);
      const featX = groups.find((g) => g.branch === 'feat-x')!;
      expect(featX.repos).toHaveLength(2);
      expect(new Set(featX.repos.map((r) => r.repoPath))).toEqual(new Set(['/repo-A', '/repo-B']));

      const featY = groups.find((g) => g.branch === 'feat-y')!;
      expect(featY.repos).toEqual([{ repoPath: '/repo-A', worktreePath: '/wt/feat-y-A' }]);
    });

    it('partial degradation: when one repo errors, others still return', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B']);

      installFakeDaemon(ctx, {
        worktreeList: new Map<string, FakeWorktree[] | Error>([
          [
            '/repo-A',
            [
              { path: '/repo-A', branch: 'main', isMain: true },
              { path: '/wt/feat-x-A', branch: 'feat-x', isMain: false },
            ],
          ],
          ['/repo-B', new Error('not a git repo')],
        ]),
      });

      const { groups, errors } = await caller.worktree.listGrouped({ projectId: proj.id });
      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual({
        branch: 'feat-x',
        repos: [{ repoPath: '/repo-A', worktreePath: '/wt/feat-x-A' }],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ repoPath: '/repo-B', message: 'not a git repo' });
    });

    it('throws NOT_FOUND for unknown project', async () => {
      await expect(caller.worktree.listGrouped({ projectId: 999 })).rejects.toThrow(
        'Project not found',
      );
    });
  });

  describe('create', () => {
    it('dispatches WORKTREE_ADD per repo (createBranch flag only on first)', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B']);
      const { sent } = installFakeDaemon(ctx, {
        addBehaviors: [{ ok: true }, { ok: true }],
      });

      const result = await caller.worktree.create({
        projectId: proj.id,
        branch: 'feat-x',
        repoPaths: ['/repo-A', '/repo-B'],
        createBranch: true,
      });

      const addRequests = sent.filter((m) => m.type === 'WORKTREE_ADD_REQUEST');
      expect(addRequests).toHaveLength(2);
      expect(addRequests[0].payload.createBranch).toBe(true);
      expect(addRequests[0].payload.repoDir).toBe('/repo-A');
      expect(addRequests[1].payload.createBranch).toBe(false);
      expect(addRequests[1].payload.repoDir).toBe('/repo-B');

      expect(result.branch).toBe('feat-x');
      expect(result.repos).toHaveLength(2);
    });

    it('rolls back already-added worktrees when a later repo fails', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B']);
      const { sent } = installFakeDaemon(ctx, {
        addBehaviors: [
          { ok: true },
          { ok: false, error: 'already exists', code: 'BRANCH_EXISTS' },
        ],
        // Remove will be called for the rollback of repo-A.
        removeBehaviors: [{ ok: true }],
      });

      await expect(
        caller.worktree.create({
          projectId: proj.id,
          branch: 'feat-x',
          repoPaths: ['/repo-A', '/repo-B'],
          createBranch: true,
        }),
      ).rejects.toThrow(/repo-B.*BRANCH_EXISTS/);

      const removeRequests = sent.filter((m) => m.type === 'WORKTREE_REMOVE_REQUEST');
      expect(removeRequests).toHaveLength(1);
      expect(removeRequests[0].payload.repoDir).toBe('/repo-A');
      expect(removeRequests[0].payload.force).toBe(true);
    });

    it('rejects when repoPaths contains a path not in workspace.repos', async () => {
      const { proj } = await seed(ctx, ['/repo-A']);
      installFakeDaemon(ctx, {});

      await expect(
        caller.worktree.create({
          projectId: proj.id,
          branch: 'feat-x',
          repoPaths: ['/some/other/repo'],
          createBranch: true,
        }),
      ).rejects.toThrow(/Repo path not in workspace/);
    });

    it('rejects invalid branch names', async () => {
      const { proj } = await seed(ctx, ['/repo-A']);
      installFakeDaemon(ctx, {});

      await expect(
        caller.worktree.create({
          projectId: proj.id,
          branch: 'bad branch',
          repoPaths: ['/repo-A'],
          createBranch: true,
        }),
      ).rejects.toThrow(/Invalid branch/);
    });
  });

  describe('sync', () => {
    it('additively reports per-repo results without rollback', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B', '/repo-C']);
      installFakeDaemon(ctx, {
        addBehaviors: [
          { ok: true },
          { ok: false, error: 'no such branch', code: 'OTHER' },
          { ok: true },
        ],
      });

      const result = await caller.worktree.sync({
        projectId: proj.id,
        branch: 'feat-x',
        repoPaths: ['/repo-A', '/repo-B', '/repo-C'],
      });

      expect(result).toHaveLength(3);
      expect(result.filter((r) => r.success)).toHaveLength(2);
      expect(result.find((r) => !r.success)).toMatchObject({ code: 'OTHER' });
    });
  });

  describe('remove', () => {
    it('returns per-repo result list and surfaces DIRTY code', async () => {
      const { proj } = await seed(ctx, ['/repo-A', '/repo-B']);
      installFakeDaemon(ctx, {
        removeBehaviors: [
          { ok: true },
          { ok: false, error: 'contains modified files', code: 'DIRTY' },
        ],
      });

      const result = await caller.worktree.remove({
        projectId: proj.id,
        branch: 'feat-x',
        repoPaths: ['/repo-A', '/repo-B'],
        force: false,
      });

      expect(result[0]).toEqual({ repoPath: '/repo-A', success: true });
      expect(result[1]).toMatchObject({ repoPath: '/repo-B', success: false, code: 'DIRTY' });
    });

    it('passes force=true through to the daemon', async () => {
      const { proj } = await seed(ctx, ['/repo-A']);
      const { sent } = installFakeDaemon(ctx, { removeBehaviors: [{ ok: true }] });

      await caller.worktree.remove({
        projectId: proj.id,
        branch: 'feat-x',
        repoPaths: ['/repo-A'],
        force: true,
      });

      const removeRequests = sent.filter((m) => m.type === 'WORKTREE_REMOVE_REQUEST');
      expect(removeRequests[0].payload.force).toBe(true);
    });
  });
});
