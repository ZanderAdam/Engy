import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('github router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    delete process.env.ENGY_GITHUB_TOKEN;
    ctx.cleanup();
  });

  describe('status', () => {
    it('should return the unavailable status when the token is missing', async () => {
      delete process.env.ENGY_GITHUB_TOKEN;

      const status = await caller.github.status();

      expect(status).toMatchObject({ available: false, reason: 'missing_token' });
    });

    it('should never include the token', async () => {
      process.env.ENGY_GITHUB_TOKEN = `github_pat_${'A'.repeat(40)}`;

      const status = await caller.github.status();

      expect(JSON.stringify(status)).not.toContain('github_pat_AAAA');
    });
  });
});
