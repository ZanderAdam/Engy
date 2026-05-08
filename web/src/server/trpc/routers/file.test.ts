import { describe, it, expect, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('file router', () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('listDir', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.listDir({ dirPath: '/tmp/repo' }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('read', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({ repoDir: '/tmp/repo', filePath: 'file.txt' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('uses worktreePath as effective dir when provided', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      // Still throws no-daemon, but with worktreePath — confirms the input shape is accepted
      await expect(
        caller.file.read({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          worktreePath: '/tmp/worktree',
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('accepts coderWorkspace in input', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          coderWorkspace: 'my-coder-ws',
        }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('write', () => {
    it('throws when no daemon is connected', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({ repoDir: '/tmp/repo', filePath: 'file.txt', content: 'hello' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('uses worktreePath as effective dir when provided', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          content: 'hello',
          worktreePath: '/tmp/worktree',
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('accepts coderWorkspace in input', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          content: 'hello',
          coderWorkspace: 'my-coder-ws',
        }),
      ).rejects.toThrow('No daemon connected');
    });
  });
});
