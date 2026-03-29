import { describe, it, expect, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { agentSessions } from '../../db/schema';

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

    it('throws when sessionId not found', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({ repoDir: '/tmp/repo', filePath: 'file.txt', sessionId: 'bad-id' }),
      ).rejects.toThrow('Session "bad-id" not found');
    });

    it('throws when session has no worktree path', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'sess-no-wt', status: 'active' })
        .run();

      await expect(
        caller.file.read({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          sessionId: 'sess-no-wt',
        }),
      ).rejects.toThrow('Session "sess-no-wt" has no worktree path');
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

    it('throws when sessionId not found', async () => {
      ctx = setupTestDb();
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          content: 'hello',
          sessionId: 'bad-id',
        }),
      ).rejects.toThrow('Session "bad-id" not found');
    });
  });
});
