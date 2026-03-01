import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root.js';
import { setupTestDb, type TestContext } from '../test-helpers.js';

describe('project router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Test WS' });
    workspaceId = ws.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a project', async () => {
      const result = await caller.project.create({
        workspaceId,
        name: 'Auth Feature',
      });
      expect(result.name).toBe('Auth Feature');
      expect(result.slug).toBe('auth-feature');
      expect(result.status).toBe('planning');
    });
  });

  describe('list', () => {
    it('should list projects for a workspace including default', async () => {
      const projects = await caller.project.list({ workspaceId });
      expect(projects.length).toBeGreaterThanOrEqual(1);
      expect(projects.some((p) => p.isDefault)).toBe(true);
    });
  });

  describe('updateStatus', () => {
    it('should update project status', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Status Test',
      });
      const updated = await caller.project.updateStatus({
        id: proj.id,
        status: 'active',
      });
      expect(updated.status).toBe('active');
    });
  });

  describe('delete', () => {
    it('should delete a project', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Delete Me',
      });
      await caller.project.delete({ id: proj.id });
      await expect(caller.project.get({ id: proj.id })).rejects.toThrow('not found');
    });
  });
});
