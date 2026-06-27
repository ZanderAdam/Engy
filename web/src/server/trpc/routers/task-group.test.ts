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

    it('should filter by workspaceId using AND logic', async () => {
      const wsA = await caller.workspace.create({ name: 'WS Alpha' });
      const wsB = await caller.workspace.create({ name: 'WS Beta' });
      const projA = await caller.project.create({ workspaceSlug: wsA.slug, name: 'Alpha Proj' });
      const projB = await caller.project.create({ workspaceSlug: wsB.slug, name: 'Beta Proj' });

      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'Alpha-Group' });
      await caller.taskGroup.create({ projectId: projB.id, milestoneRef: 'm1', name: 'Beta-Group' });

      const resultA = await caller.taskGroup.list({ workspaceId: wsA.id });
      expect(resultA).toHaveLength(1);
      expect(resultA[0].name).toBe('Alpha-Group');
      expect(resultA[0].projectId).toBe(projA.id);

      const resultB = await caller.taskGroup.list({ workspaceId: wsB.id });
      expect(resultB).toHaveLength(1);
      expect(resultB[0].name).toBe('Beta-Group');
      expect(resultB[0].projectId).toBe(projB.id);
    });

    it('should AND workspaceId with projectId and milestoneRef', async () => {
      const wsA = await caller.workspace.create({ name: 'Combo WS A' });
      const wsB = await caller.workspace.create({ name: 'Combo WS B' });
      const projA = await caller.project.create({ workspaceSlug: wsA.slug, name: 'Combo Proj A' });
      const projB = await caller.project.create({ workspaceSlug: wsB.slug, name: 'Combo Proj B' });

      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'A-m1' });
      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm2', name: 'A-m2' });
      await caller.taskGroup.create({ projectId: projB.id, milestoneRef: 'm1', name: 'B-m1' });

      const match = await caller.taskGroup.list({
        workspaceId: wsA.id,
        projectId: projA.id,
        milestoneRef: 'm1',
      });
      expect(match).toHaveLength(1);
      expect(match[0].name).toBe('A-m1');

      const mismatch = await caller.taskGroup.list({
        workspaceId: wsA.id,
        projectId: projB.id,
      });
      expect(mismatch).toHaveLength(0);
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

  describe('[FR-TASK-150] create numInMilestone', () => {
    it('should assign 1 to the first group in a milestone', async () => {
      const ws = await caller.workspace.create({ name: 'Num WS' });
      const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Num Proj' });
      const tg = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG1' });
      expect(tg.numInMilestone).toBe(1);
    });

    it('should assign sequential nums within a milestone', async () => {
      const ws = await caller.workspace.create({ name: 'Seq WS' });
      const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Seq Proj' });
      const tg1 = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG1' });
      const tg2 = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG2' });
      const tg3 = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG3' });
      expect(tg1.numInMilestone).toBe(1);
      expect(tg2.numInMilestone).toBe(2);
      expect(tg3.numInMilestone).toBe(3);
    });

    it('should restart at 1 for a different milestone in the same project', async () => {
      const ws = await caller.workspace.create({ name: 'Restart WS' });
      const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Restart Proj' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'M1-TG1' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'M1-TG2' });
      const m2tg1 = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm2', name: 'M2-TG1' });
      expect(m2tg1.numInMilestone).toBe(1);
    });

    it('should number independently per project', async () => {
      const ws = await caller.workspace.create({ name: 'Indep WS 2' });
      const projA = await caller.project.create({ workspaceSlug: ws.slug, name: 'Proj A' });
      const projB = await caller.project.create({ workspaceSlug: ws.slug, name: 'Proj B' });

      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'A-TG1' });
      await caller.taskGroup.create({ projectId: projA.id, milestoneRef: 'm1', name: 'A-TG2' });
      const bTg1 = await caller.taskGroup.create({ projectId: projB.id, milestoneRef: 'm1', name: 'B-TG1' });
      expect(bTg1.numInMilestone).toBe(1);
    }, 15000);

    it('list should return numInMilestone field', async () => {
      const ws = await caller.workspace.create({ name: 'List Num WS' });
      const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'List Num Proj' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG1' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG2' });
      const groups = await caller.taskGroup.list({ projectId: proj.id, milestoneRef: 'm1' });
      expect(groups[0]).toHaveProperty('numInMilestone');
      const nums = groups.map((g) => g.numInMilestone).sort();
      expect(nums).toEqual([1, 2]);
    });

    it('delete should not renumber survivors — gaps are allowed', async () => {
      const ws = await caller.workspace.create({ name: 'Gap WS' });
      const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Gap Proj' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG1' });
      const tg2 = await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG2' });
      await caller.taskGroup.create({ projectId: proj.id, milestoneRef: 'm1', name: 'TG3' });

      await caller.taskGroup.delete({ id: tg2.id });

      const survivors = await caller.taskGroup.list({ projectId: proj.id, milestoneRef: 'm1' });
      const nums = survivors.map((g) => g.numInMilestone).sort();
      // TG2 deleted, survivors keep their original nums (1 and 3)
      expect(nums).toEqual([1, 3]);
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

    it('[FR-TASK-160] should throw NOT_FOUND for non-existent task group', async () => {
      await expect(
        caller.taskGroup.update({ id: 99999, name: 'Nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('[FR-TASK-160] should delete an existing task group', async () => {
      const group = await caller.taskGroup.create({ milestoneRef, name: 'Delete Me' });
      await caller.taskGroup.delete({ id: group.id });
      await expect(caller.taskGroup.get({ id: group.id })).rejects.toThrow('not found');
    });
  });
});
