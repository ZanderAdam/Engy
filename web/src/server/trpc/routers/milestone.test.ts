import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('milestone router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let projectId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Milestone WS' });
    const proj = await caller.project.create({
      workspaceSlug: ws.slug,
      name: 'Milestone Project',
    });
    projectId = proj.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a milestone file', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        num: 1,
        title: 'Foundation',
      });
      expect(milestone.ref).toBe('m1');
      expect(milestone.num).toBe(1);
      expect(milestone.title).toBe('Foundation');
      expect(milestone.status).toBe('planned');
      expect(milestone.filename).toBe('m1-foundation.plan.md');
    });

    it('should support decimal milestone numbers', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        num: 1.5,
        title: 'Auth Setup',
      });
      expect(milestone.ref).toBe('m1.5');
      expect(milestone.num).toBe(1.5);
    });

    it('should create a milestone with scope', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        num: 2,
        title: 'API Layer',
        scope: 'REST endpoints only',
      });
      expect(milestone.scope).toBe('REST endpoints only');
    });
  });

  describe('list', () => {
    it('should list milestones sorted by number', async () => {
      await caller.milestone.create({ projectId, num: 2, title: 'Second' });
      await caller.milestone.create({ projectId, num: 1, title: 'First' });
      const list = await caller.milestone.list({ projectId });
      expect(list[0].num).toBe(1);
      expect(list[1].num).toBe(2);
    });

    it('should return empty list for project with no milestones', async () => {
      const list = await caller.milestone.list({ projectId });
      expect(list).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should get a milestone by filename', async () => {
      const created = await caller.milestone.create({ projectId, num: 1, title: 'Get Test' });
      const fetched = await caller.milestone.get({ projectId, filename: created.filename });
      expect(fetched.title).toBe('Get Test');
    });

    it('should throw NOT_FOUND for missing filename', async () => {
      await expect(
        caller.milestone.get({ projectId, filename: 'm99-nope.plan.md' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should update milestone title and rename file', async () => {
      const milestone = await caller.milestone.create({ projectId, num: 1, title: 'Original' });
      const updated = await caller.milestone.update({
        projectId,
        filename: milestone.filename,
        title: 'Updated Title',
      });
      expect(updated.title).toBe('Updated Title');
      expect(updated.filename).toBe('m1-updated-title.plan.md');
    });

    it('should allow valid forward status transitions', async () => {
      const m = await caller.milestone.create({ projectId, num: 1, title: 'Forward Test' });
      const m2 = await caller.milestone.update({ projectId, filename: m.filename, status: 'planning' });
      const m3 = await caller.milestone.update({ projectId, filename: m2.filename, status: 'active' });
      const result = await caller.milestone.update({ projectId, filename: m3.filename, status: 'complete' });
      expect(result.status).toBe('complete');
    });

    it('should reject skipping milestone status transitions', async () => {
      const m = await caller.milestone.create({ projectId, num: 1, title: 'Skip Test' });
      await expect(
        caller.milestone.update({ projectId, filename: m.filename, status: 'active' }),
      ).rejects.toThrow('invalid milestone status transition');
    });

    it('should reject backward milestone status transitions', async () => {
      const m = await caller.milestone.create({ projectId, num: 1, title: 'Backward Test' });
      const m2 = await caller.milestone.update({ projectId, filename: m.filename, status: 'planning' });
      const m3 = await caller.milestone.update({ projectId, filename: m2.filename, status: 'active' });
      await expect(
        caller.milestone.update({ projectId, filename: m3.filename, status: 'planned' }),
      ).rejects.toThrow('invalid milestone status transition');
    });

    it('should update scope', async () => {
      const m = await caller.milestone.create({ projectId, num: 1, title: 'Scope Test' });
      const updated = await caller.milestone.update({
        projectId,
        filename: m.filename,
        scope: 'Backend only',
      });
      expect(updated.scope).toBe('Backend only');
    });

    it('should throw NOT_FOUND for non-existent filename', async () => {
      await expect(
        caller.milestone.update({ projectId, filename: 'm99-nope.plan.md', title: 'Nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete an existing milestone', async () => {
      const milestone = await caller.milestone.create({ projectId, num: 1, title: 'Delete Me' });
      await caller.milestone.delete({ projectId, filename: milestone.filename });
      const list = await caller.milestone.list({ projectId });
      expect(list).toHaveLength(0);
    });

    it('should succeed silently for non-existent file', async () => {
      await expect(
        caller.milestone.delete({ projectId, filename: 'm99-nope.plan.md' }),
      ).resolves.toEqual({ success: true });
    });
  });
});
