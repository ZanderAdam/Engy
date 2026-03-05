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

  describe('update', () => {
    it('should update milestone title', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Original Title',
      });
      const updated = await caller.milestone.update({
        id: milestone.id,
        title: 'Updated Title',
      });
      expect(updated.title).toBe('Updated Title');
    });

    it('should allow valid forward status transitions', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Forward Test',
      });
      await caller.milestone.update({ id: milestone.id, status: 'planning' });
      await caller.milestone.update({ id: milestone.id, status: 'active' });
      const result = await caller.milestone.update({
        id: milestone.id,
        status: 'complete',
      });
      expect(result.status).toBe('complete');
    });

    it('should reject skipping milestone status transitions', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Skip Test',
      });
      await expect(
        caller.milestone.update({ id: milestone.id, status: 'active' }),
      ).rejects.toThrow('invalid milestone status transition');
    });

    it('should reject backward milestone status transitions', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Backward Test',
      });
      await caller.milestone.update({ id: milestone.id, status: 'planning' });
      await caller.milestone.update({ id: milestone.id, status: 'active' });
      await expect(
        caller.milestone.update({ id: milestone.id, status: 'planned' }),
      ).rejects.toThrow('invalid milestone status transition');
    });

    it('should allow update without status change', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'No Status Change',
      });
      const updated = await caller.milestone.update({
        id: milestone.id,
        title: 'New Title',
      });
      expect(updated.title).toBe('New Title');
      expect(updated.status).toBe('planned');
    });

    it('should update milestone scope', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Scope Test',
      });
      const updated = await caller.milestone.update({
        id: milestone.id,
        scope: 'Backend API endpoints',
      });
      expect(updated.scope).toBe('Backend API endpoints');
    });

    it('should update milestone sortOrder', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Sort Test',
      });
      const updated = await caller.milestone.update({
        id: milestone.id,
        sortOrder: 5,
      });
      expect(updated.sortOrder).toBe(5);
    });

    it('should throw NOT_FOUND for non-existent milestone', async () => {
      await expect(
        caller.milestone.update({ id: 99999, title: 'Nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('reorder', () => {
    it('should reorder multiple milestones', async () => {
      const m1 = await caller.milestone.create({
        projectId,
        title: 'First',
        sortOrder: 0,
      });
      const m2 = await caller.milestone.create({
        projectId,
        title: 'Second',
        sortOrder: 1,
      });
      const m3 = await caller.milestone.create({
        projectId,
        title: 'Third',
        sortOrder: 2,
      });

      await caller.milestone.reorder([
        { id: m1.id, sortOrder: 2 },
        { id: m2.id, sortOrder: 0 },
        { id: m3.id, sortOrder: 1 },
      ]);

      const list = await caller.milestone.list({ projectId });
      expect(list[0].title).toBe('Second');
      expect(list[1].title).toBe('Third');
      expect(list[2].title).toBe('First');
    });
  });

  describe('delete', () => {
    it('should delete an existing milestone', async () => {
      const milestone = await caller.milestone.create({
        projectId,
        title: 'Delete Me',
      });
      await caller.milestone.delete({ id: milestone.id });
      await expect(caller.milestone.get({ id: milestone.id })).rejects.toThrow(
        'not found',
      );
    });
  });
});
