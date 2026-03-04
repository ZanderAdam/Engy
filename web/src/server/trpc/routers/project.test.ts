import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

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

  describe('get', () => {
    it('should return a project by id', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Get Test',
      });
      const result = await caller.project.get({ id: proj.id });
      expect(result.name).toBe('Get Test');
      expect(result.slug).toBe('get-test');
    });

    it('should throw NOT_FOUND for non-existent project', async () => {
      await expect(caller.project.get({ id: 9999 })).rejects.toThrow('not found');
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

    it('should throw NOT_FOUND for non-existent project', async () => {
      await expect(
        caller.project.updateStatus({ id: 9999, status: 'active' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('getBySlug', () => {
    it('should return a project by workspaceId and slug', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Auth Feature',
      });
      const result = await caller.project.getBySlug({
        workspaceId,
        slug: 'auth-feature',
      });
      expect(result.id).toBe(proj.id);
      expect(result.name).toBe('Auth Feature');
    });

    it('should throw NOT_FOUND for non-existent slug', async () => {
      await expect(
        caller.project.getBySlug({ workspaceId, slug: 'nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('listWithProgress', () => {
    it('should return projects with progress counts', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Progress Test',
      });
      const m1 = await caller.milestone.create({
        projectId: proj.id,
        title: 'M1',
      });
      await caller.milestone.update({ id: m1.id, status: 'planning' });
      await caller.milestone.update({ id: m1.id, status: 'active' });
      await caller.milestone.update({ id: m1.id, status: 'complete' });

      const m2 = await caller.milestone.create({
        projectId: proj.id,
        title: 'M2',
      });

      await caller.task.create({ projectId: proj.id, milestoneId: m1.id, title: 'T1' });
      const t2 = await caller.task.create({
        projectId: proj.id,
        milestoneId: m2.id,
        title: 'T2',
      });
      await caller.task.update({ id: t2.id, status: 'done' });

      const result = await caller.project.listWithProgress({ workspaceId });
      const p = result.find((r) => r.id === proj.id);
      expect(p).toBeDefined();
      expect(p!.milestoneCount).toBe(2);
      expect(p!.completedMilestones).toBe(1);
      expect(p!.taskCount).toBe(2);
      expect(p!.completedTasks).toBe(1);
    });

    it('should return zero counts for project with no milestones or tasks', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Empty Project',
      });
      const result = await caller.project.listWithProgress({ workspaceId });
      const p = result.find((r) => r.id === proj.id);
      expect(p).toBeDefined();
      expect(p!.milestoneCount).toBe(0);
      expect(p!.completedMilestones).toBe(0);
      expect(p!.taskCount).toBe(0);
      expect(p!.completedTasks).toBe(0);
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

    it('should allow valid forward transitions', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Forward Test',
      });
      await caller.project.updateStatus({ id: proj.id, status: 'active' });
      await caller.project.updateStatus({ id: proj.id, status: 'completing' });
      const result = await caller.project.updateStatus({
        id: proj.id,
        status: 'archived',
      });
      expect(result.status).toBe('archived');
    });

    it('should reject invalid status transition (skip)', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Skip Test',
      });
      await expect(
        caller.project.updateStatus({ id: proj.id, status: 'archived' }),
      ).rejects.toThrow('invalid status transition');
    });

    it('should reject backward status transition', async () => {
      const proj = await caller.project.create({
        workspaceId,
        name: 'Backward Test',
      });
      await caller.project.updateStatus({ id: proj.id, status: 'active' });
      await expect(
        caller.project.updateStatus({ id: proj.id, status: 'planning' }),
      ).rejects.toThrow('invalid status transition');
    });

    it('should throw NOT_FOUND for non-existent project', async () => {
      await expect(
        caller.project.updateStatus({ id: 9999, status: 'active' }),
      ).rejects.toThrow('not found');
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
