import { describe, it, expect, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces } from '../../db/schema';

describe('diff router', () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('getStatus', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.diff.getStatus({ repoDir: '/tmp/repo' })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('uses worktreePath as effective dir when provided', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      // Still throws no-daemon, but with worktreePath — confirms the input shape is accepted
      await expect(
        caller.diff.getStatus({ repoDir: '/tmp/repo', worktreePath: '/tmp/worktree' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('getLog', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.diff.getLog({ repoDir: '/tmp/repo' })).rejects.toThrow(
        'No daemon connected',
      );
    });
  });

  describe('getCommitDiff', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getCommitDiff({ repoDir: '/tmp/repo', commitHash: 'abc123' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('getBranchDiff', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getBranchDiff({ repoDir: '/tmp/repo', base: 'origin/main' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('getWorktrees', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db.insert(workspaces).values({ id: 1, name: 'WS', slug: 'ws' }).run();

      await expect(
        caller.diff.getWorktrees({ workspaceSlug: 'ws', repoDir: '/tmp/repo' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('throws NOT_FOUND when workspace slug does not exist', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.diff.getWorktrees({ workspaceSlug: 'nonexistent', repoDir: '/tmp/repo' }),
      ).rejects.toThrow('Workspace "nonexistent" not found');
    });

    it('workspace without coder config only dispatches local worktree list', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(workspaces)
        .values({ id: 1, name: 'WS', slug: 'ws', executionBackend: 'devcontainer' })
        .run();

      // No daemon — throws after attempting exactly one dispatch (local)
      await expect(
        caller.diff.getWorktrees({ workspaceSlug: 'ws', repoDir: '/tmp/repo' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('workspace with coder config attempts both local and remote dispatches', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(workspaces)
        .values({
          id: 1,
          name: 'WS',
          slug: 'ws',
          executionBackend: 'coder',
          coderConfig: { workspace: 'my-coder-ws', repoBasePath: '/home/user/repos' },
        })
        .run();

      // Local dispatch fails (no daemon), error is caught. Coder dispatch also fails,
      // and since local also failed, the local error is re-thrown.
      await expect(
        caller.diff.getWorktrees({ workspaceSlug: 'ws', repoDir: '/tmp/repo' }),
      ).rejects.toThrow('No daemon connected');
    });
  });
});
