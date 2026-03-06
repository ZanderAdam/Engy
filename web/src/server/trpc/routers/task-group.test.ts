import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('task-group router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  const milestoneRef = 'm1';

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    await caller.workspace.create({ name: 'TaskGroup WS' });
    await caller.project.create({
      workspaceSlug: 'taskgroup-ws',
      name: 'TaskGroup Project',
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('list', () => {
    it('should list task groups for a milestone', async () => {
      await caller.taskGroup.create({ milestoneRef, name: 'Group A' });
      await caller.taskGroup.create({ milestoneRef, name: 'Group B' });
      const result = await caller.taskGroup.list({ milestoneRef });
      expect(result).toHaveLength(2);
    });

    it('should return empty list when milestone has no groups', async () => {
      const result = await caller.taskGroup.list({ milestoneRef });
      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update task group name', async () => {
      const group = await caller.taskGroup.create({ milestoneRef, name: 'Original Name' });
      const updated = await caller.taskGroup.update({ id: group.id, name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
    });

    it('should update task group status', async () => {
      const group = await caller.taskGroup.create({ milestoneRef, name: 'Status Test' });
      const updated = await caller.taskGroup.update({ id: group.id, status: 'active' });
      expect(updated.status).toBe('active');
    });

    it('should update task group repos', async () => {
      const group = await caller.taskGroup.create({ milestoneRef, name: 'Repos Test' });
      const updated = await caller.taskGroup.update({ id: group.id, repos: ['repo-a', 'repo-b'] });
      expect(updated.repos).toEqual(['repo-a', 'repo-b']);
    });

    it('should throw NOT_FOUND for non-existent task group', async () => {
      await expect(
        caller.taskGroup.update({ id: 99999, name: 'Nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete an existing task group', async () => {
      const group = await caller.taskGroup.create({ milestoneRef, name: 'Delete Me' });
      await caller.taskGroup.delete({ id: group.id });
      await expect(caller.taskGroup.get({ id: group.id })).rejects.toThrow('not found');
    });
  });
});
