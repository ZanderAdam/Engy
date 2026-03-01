import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

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

    it('should reject non-existent dependency', async () => {
      await expect(
        caller.task.create({
          projectId,
          title: 'Bad deps',
          dependencies: [9999],
        }),
      ).rejects.toThrow('Dependency task 9999 does not exist');
    });
  });

  describe('list', () => {
    it('should list tasks by project', async () => {
      await caller.task.create({ projectId, title: 'T1' });
      await caller.task.create({ projectId, title: 'T2' });
      const result = await caller.task.list({ projectId });
      expect(result).toHaveLength(2);
    });

    it('should list tasks by milestoneId', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'M1',
      });
      await caller.task.create({ projectId, milestoneId: milestone.id, title: 'MT1' });
      await caller.task.create({ projectId, milestoneId: milestone.id, title: 'MT2' });
      await caller.task.create({ projectId, title: 'Unlinked' });

      const result = await caller.task.list({ milestoneId: milestone.id });
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.milestoneId === milestone.id)).toBe(true);
    });

    it('should list tasks by taskGroupId', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'M1',
      });
      const group = await caller.taskGroup.create({
        milestoneId: milestone.id,
        name: 'Group 1',
      });
      await caller.task.create({ projectId, taskGroupId: group.id, title: 'GT1' });
      await caller.task.create({ projectId, taskGroupId: group.id, title: 'GT2' });
      await caller.task.create({ projectId, title: 'No group' });

      const result = await caller.task.list({ taskGroupId: group.id });
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.taskGroupId === group.id)).toBe(true);
    });

    it('should return all tasks when no filter provided', async () => {
      await caller.task.create({ projectId, title: 'A1' });
      await caller.task.create({ projectId, title: 'A2' });
      await caller.task.create({ projectId, title: 'A3' });

      const result = await caller.task.list({});
      expect(result).toHaveLength(3);
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

    it('should throw NOT_FOUND for non-existent task', async () => {
      await expect(
        caller.task.update({ id: 9999, status: 'done' }),
      ).rejects.toThrow('Task not found');
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
