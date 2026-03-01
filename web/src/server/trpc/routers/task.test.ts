import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root.js';
import { setupTestDb, type TestContext } from '../test-helpers.js';

describe('task router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let projectId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Task WS' });
    const proj = await caller.project.create({
      workspaceId: ws.id,
      name: 'Task Project',
    });
    projectId = proj.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a task with defaults', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Write tests',
      });
      expect(task.status).toBe('todo');
      expect(task.type).toBe('human');
      expect(task.dependencies).toEqual([]);
    });

    it('should create a task with dependencies', async () => {
      const t1 = await caller.task.create({
        projectId,
        title: 'First task',
      });
      const t2 = await caller.task.create({
        projectId,
        title: 'Second task',
        dependencies: [t1.id],
      });
      expect(t2.dependencies).toEqual([t1.id]);
    });
  });

  describe('list', () => {
    it('should list tasks by project', async () => {
      await caller.task.create({ projectId, title: 'T1' });
      await caller.task.create({ projectId, title: 'T2' });
      const result = await caller.task.list({ projectId });
      expect(result).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('should update task status', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Update me',
      });
      const updated = await caller.task.update({
        id: task.id,
        status: 'in_progress',
      });
      expect(updated.status).toBe('in_progress');
    });

    it('should detect circular dependencies', async () => {
      const t1 = await caller.task.create({
        projectId,
        title: 'T1',
      });
      const t2 = await caller.task.create({
        projectId,
        title: 'T2',
        dependencies: [t1.id],
      });

      await expect(
        caller.task.update({
          id: t1.id,
          dependencies: [t2.id],
        }),
      ).rejects.toThrow('Circular dependency');
    });
  });

  describe('delete', () => {
    it('should delete a task', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Delete me',
      });
      await caller.task.delete({ id: task.id });
      await expect(caller.task.get({ id: task.id })).rejects.toThrow('not found');
    });
  });
});
