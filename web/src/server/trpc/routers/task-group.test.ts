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

    it('should filter by projectId using AND logic', async () => {
      const ws = await caller.workspace.create({ name: 'Filter WS' });
      const projA = await caller.project.create({ workspaceSlug: ws.slug, name: 'Project A' });
      const projB = await caller.project.create({ workspaceSlug: ws.slug, name: 'Project B' });

      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'A-Group' });
      await caller.taskGroup.create({ projectId: projB.id, milestoneRef: 'm1', name: 'B-Group' });

      const resultA = await caller.taskGroup.list({ projectId: projA.id, milestoneRef: 'm1' });
      expect(resultA).toHaveLength(1);
      expect(resultA[0].name).toBe('A-Group');

      const resultB = await caller.taskGroup.list({ projectId: projB.id, milestoneRef: 'm1' });
      expect(resultB).toHaveLength(1);
      expect(resultB[0].name).toBe('B-Group');
    });

    it('should return all groups for milestoneRef without projectId', async () => {
      const ws = await caller.workspace.create({ name: 'No Filter WS' });
      const projA = await caller.project.create({ workspaceSlug: ws.slug, name: 'PA' });
      const projB = await caller.project.create({ workspaceSlug: ws.slug, name: 'PB' });

      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'G1' });
      await caller.taskGroup.create({ projectId: projB.id, milestoneRef: 'm1', name: 'G2' });

      const result = await caller.taskGroup.list({ milestoneRef: 'm1' });
      expect(result).toHaveLength(2);
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
