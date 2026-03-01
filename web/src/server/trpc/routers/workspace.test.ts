import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root.js';
import { setupTestDb, type TestContext } from '../test-helpers.js';

describe('workspace router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a workspace with slug derived from name', async () => {
      const result = await caller.workspace.create({ name: 'My Workspace' });
      expect(result.name).toBe('My Workspace');
      expect(result.slug).toBe('my-workspace');
    });

    it('should handle slug collisions with numeric suffix', async () => {
      await caller.workspace.create({ name: 'Test' });
      const second = await caller.workspace.create({ name: 'Test' });
      expect(second.slug).toBe('test-2');
    });

    it('should fail when repos provided but no daemon connected', async () => {
      await expect(
        caller.workspace.create({ name: 'WS', repos: ['/some/path'] }),
      ).rejects.toThrow('Client daemon is not running');
    });
  });

  describe('list', () => {
    it('should return all workspaces', async () => {
      await caller.workspace.create({ name: 'WS1' });
      await caller.workspace.create({ name: 'WS2' });
      const result = await caller.workspace.list();
      expect(result).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return a workspace by slug', async () => {
      await caller.workspace.create({ name: 'My WS' });
      const result = await caller.workspace.get({ slug: 'my-ws' });
      expect(result.name).toBe('My WS');
    });

    it('should throw NOT_FOUND for missing workspace', async () => {
      await expect(caller.workspace.get({ slug: 'nope' })).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete a workspace', async () => {
      const ws = await caller.workspace.create({ name: 'Delete Me' });
      await caller.workspace.delete({ id: ws.id });
      const list = await caller.workspace.list();
      expect(list).toHaveLength(0);
    });
  });
});
