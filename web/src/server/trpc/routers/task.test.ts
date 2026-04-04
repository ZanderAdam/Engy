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
      workspaceSlug: ws.slug,
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
      expect(task.needsPlan).toBe(true);
      expect(task.blockedBy).toEqual([]);
    });

    it('should create a task with needsPlan false', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Quick fix',
        needsPlan: false,
      });
      expect(task.needsPlan).toBe(false);
    });

    it('should create a task with blockedBy', async () => {
      const t1 = await caller.task.create({
        projectId,
        title: 'First task',
      });
      const t2 = await caller.task.create({
        projectId,
        title: 'Second task',
        blockedBy: [t1.id],
      });
      expect(t2.blockedBy).toEqual([t1.id]);
    });

    it('should create a task with specId and no projectId', async () => {
      const task = await caller.task.create({
        title: 'Spec task',
        specId: 'my-spec',
        type: 'human',
        description: 'A description',
      });
      expect(task.title).toBe('Spec task');
      expect(task.specId).toBe('my-spec');
      expect(task.projectId).toBeNull();
    });

    it('should reject non-existent blocker', async () => {
      await expect(
        caller.task.create({
          projectId,
          title: 'Bad deps',
          blockedBy: [9999],
        }),
      ).rejects.toThrow('Task 9999 does not exist');
    });
  });

  describe('list', () => {
    it('should list tasks by project', async () => {
      await caller.task.create({ projectId, title: 'T1' });
      await caller.task.create({ projectId, title: 'T2' });
      const result = await caller.task.list({ projectId });
      expect(result).toHaveLength(2);
    });

    it('should list tasks by milestoneRef', async () => {
      await caller.task.create({ projectId, milestoneRef: 'm1', title: 'MT1' });
      await caller.task.create({ projectId, milestoneRef: 'm1', title: 'MT2' });
      await caller.task.create({ projectId, title: 'Unlinked' });

      const result = await caller.task.list({ milestoneRef: 'm1' });
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.milestoneRef === 'm1')).toBe(true);
    });

    it('should list tasks by taskGroupId', async () => {
      const group = await caller.taskGroup.create({
        milestoneRef: 'm1',
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

    it('should include blockedBy in list results', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Blocker' });
      await caller.task.create({ projectId, title: 'Blocked', blockedBy: [t1.id] });

      const result = await caller.task.list({ projectId });
      const blocked = result.find((t) => t.title === 'Blocked');
      expect(blocked?.blockedBy).toEqual([t1.id]);
    });

    it('should combine milestoneRef and projectId with AND logic', async () => {
      const ws = await caller.workspace.create({ name: 'Cross WS' });
      const projB = await caller.project.create({ workspaceSlug: ws.slug, name: 'Other Project' });

      await caller.task.create({ projectId, milestoneRef: 'm1', title: 'ProjA-M1' });
      await caller.task.create({ projectId: projB.id, milestoneRef: 'm1', title: 'ProjB-M1' });

      const resultA = await caller.task.list({ projectId, milestoneRef: 'm1' });
      expect(resultA).toHaveLength(1);
      expect(resultA[0].title).toBe('ProjA-M1');

      const resultB = await caller.task.list({ projectId: projB.id, milestoneRef: 'm1' });
      expect(resultB).toHaveLength(1);
      expect(resultB[0].title).toBe('ProjB-M1');
    });
  });

  describe('get', () => {
    it('should include blockedBy in get result', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Blocker' });
      const t2 = await caller.task.create({
        projectId,
        title: 'Blocked',
        blockedBy: [t1.id],
      });

      const fetched = await caller.task.get({ id: t2.id });
      expect(fetched.blockedBy).toEqual([t1.id]);
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

    it('should update needsPlan', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Plan toggle',
      });
      expect(task.needsPlan).toBe(true);

      const updated = await caller.task.update({
        id: task.id,
        needsPlan: false,
      });
      expect(updated.needsPlan).toBe(false);

      const restored = await caller.task.update({
        id: task.id,
        needsPlan: true,
      });
      expect(restored.needsPlan).toBe(true);
    });

    it('should update blockedBy', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Blocker 1' });
      const t2 = await caller.task.create({ projectId, title: 'Blocker 2' });
      const task = await caller.task.create({ projectId, title: 'Task' });

      const updated = await caller.task.update({
        id: task.id,
        blockedBy: [t1.id, t2.id],
      });
      expect(updated.blockedBy).toEqual(expect.arrayContaining([t1.id, t2.id]));
    });

    it('should replace blockedBy on update', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Blocker 1' });
      const t2 = await caller.task.create({ projectId, title: 'Blocker 2' });
      const task = await caller.task.create({
        projectId,
        title: 'Task',
        blockedBy: [t1.id],
      });

      const updated = await caller.task.update({
        id: task.id,
        blockedBy: [t2.id],
      });
      expect(updated.blockedBy).toEqual([t2.id]);
    });

    it('should clear blockedBy with empty array', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Blocker' });
      const task = await caller.task.create({
        projectId,
        title: 'Task',
        blockedBy: [t1.id],
      });

      const updated = await caller.task.update({
        id: task.id,
        blockedBy: [],
      });
      expect(updated.blockedBy).toEqual([]);
    });

    it('should reject self-blocking', async () => {
      const task = await caller.task.create({ projectId, title: 'Self' });
      await expect(
        caller.task.update({ id: task.id, blockedBy: [task.id] }),
      ).rejects.toThrow('A task cannot block itself');
    });

    it('should detect circular dependencies', async () => {
      const t1 = await caller.task.create({
        projectId,
        title: 'T1',
      });
      const t2 = await caller.task.create({
        projectId,
        title: 'T2',
        blockedBy: [t1.id],
      });

      await expect(
        caller.task.update({
          id: t1.id,
          blockedBy: [t2.id],
        }),
      ).rejects.toThrow('Circular dependency');
    });

    it('should throw NOT_FOUND for non-existent task', async () => {
      await expect(
        caller.task.update({ id: 9999, status: 'done' }),
      ).rejects.toThrow('Task not found');
    });
  });

  describe('execution fields', () => {
    it('should create a task with subStatus and sessionId', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Executing task',
        subStatus: 'implementing',
        sessionId: 'uuid-123',
      });
      expect(task.subStatus).toBe('implementing');
      expect(task.sessionId).toBe('uuid-123');
    });

    it('should update subStatus and sessionId', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Update exec fields',
      });
      expect(task.subStatus).toBeNull();
      expect(task.sessionId).toBeNull();

      const updated = await caller.task.update({
        id: task.id,
        subStatus: 'implementing',
        sessionId: 'uuid-123',
      });
      expect(updated.subStatus).toBe('implementing');
      expect(updated.sessionId).toBe('uuid-123');
    });

    it('should persist feedback', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Feedback task',
        feedback: 'needs more tests',
      });
      expect(task.feedback).toBe('needs more tests');

      const fetched = await caller.task.get({ id: task.id });
      expect(fetched.feedback).toBe('needs more tests');
    });

    it('should clear subStatus with null', async () => {
      const task = await caller.task.create({
        projectId,
        title: 'Clear sub status',
        subStatus: 'planning',
      });
      const updated = await caller.task.update({
        id: task.id,
        subStatus: null,
      });
      expect(updated.subStatus).toBeNull();
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

    it('should cascade delete dependencies when task is deleted', async () => {
      const blocker = await caller.task.create({ projectId, title: 'Blocker' });
      const task = await caller.task.create({
        projectId,
        title: 'Blocked',
        blockedBy: [blocker.id],
      });

      await caller.task.delete({ id: blocker.id });
      const fetched = await caller.task.get({ id: task.id });
      expect(fetched.blockedBy).toEqual([]);
    });
  });

  describe('bulkUpdate', () => {
    it('should update milestoneRef for multiple tasks', async () => {
      const t1 = await caller.task.create({ projectId, title: 'T1' });
      const t2 = await caller.task.create({ projectId, title: 'T2' });
      const t3 = await caller.task.create({ projectId, title: 'T3' });

      const result = await caller.task.bulkUpdate({
        ids: [t1.id, t2.id, t3.id],
        milestoneRef: 'm1',
      });

      expect(result.updated).toBe(3);
      const fetched = await caller.task.list({ projectId });
      expect(fetched.every((t) => t.milestoneRef === 'm1')).toBe(true);
    });

    it('should update taskGroupId for multiple tasks', async () => {
      const group = await caller.taskGroup.create({
        milestoneRef: 'm1',
        name: 'Bulk Group',
      });
      const t1 = await caller.task.create({ projectId, title: 'T1' });
      const t2 = await caller.task.create({ projectId, title: 'T2' });

      const result = await caller.task.bulkUpdate({
        ids: [t1.id, t2.id],
        taskGroupId: group.id,
      });

      expect(result.updated).toBe(2);
      const fetched = await caller.task.list({ taskGroupId: group.id });
      expect(fetched).toHaveLength(2);
    });

    it('should handle empty ids array', async () => {
      const result = await caller.task.bulkUpdate({
        ids: [],
        milestoneRef: 'm1',
      });
      expect(result.updated).toBe(0);
    });

    it('should only update tasks that exist', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Exists' });

      const result = await caller.task.bulkUpdate({
        ids: [t1.id, 9999],
        milestoneRef: 'm2',
      });

      expect(result.updated).toBe(1);
      const fetched = await caller.task.get({ id: t1.id });
      expect(fetched.milestoneRef).toBe('m2');
    });

    it('should clear milestoneRef with null', async () => {
      const t1 = await caller.task.create({ projectId, title: 'T1', milestoneRef: 'm1' });

      const result = await caller.task.bulkUpdate({
        ids: [t1.id],
        milestoneRef: null,
      });

      expect(result.updated).toBe(1);
      const fetched = await caller.task.get({ id: t1.id });
      expect(fetched.milestoneRef).toBeNull();
    });
  });

  describe('bulkDelete', () => {
    it('should delete multiple tasks', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Delete1' });
      const t2 = await caller.task.create({ projectId, title: 'Delete2' });
      await caller.task.create({ projectId, title: 'Keep' });

      const result = await caller.task.bulkDelete({ ids: [t1.id, t2.id] });

      expect(result.deleted).toBe(2);
      const remaining = await caller.task.list({ projectId });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe('Keep');
    });

    it('should handle empty ids array', async () => {
      const result = await caller.task.bulkDelete({ ids: [] });
      expect(result.deleted).toBe(0);
    });

    it('should handle non-existent ids gracefully', async () => {
      const t1 = await caller.task.create({ projectId, title: 'Exists' });

      const result = await caller.task.bulkDelete({ ids: [t1.id, 9999] });

      expect(result.deleted).toBe(1);
      await expect(caller.task.get({ id: t1.id })).rejects.toThrow('not found');
    });
  });
});
