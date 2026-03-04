import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('planContent router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let milestoneId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Plan WS' });
    const proj = await caller.project.create({
      workspaceId: ws.id,
      name: 'Plan Project',
    });
    const milestone = await caller.milestone.create({
      projectId: proj.id,
      title: 'M1',
    });
    milestoneId = milestone.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('get', () => {
    it('should return null for milestone with no plan content', async () => {
      const result = await caller.planContent.get({ milestoneId });
      expect(result).toBeNull();
    });

    it('should return plan content after upsert', async () => {
      await caller.planContent.upsert({
        milestoneId,
        content: '## Implementation\nStep 1...',
      });
      const result = await caller.planContent.get({ milestoneId });
      expect(result).not.toBeNull();
      expect(result!.content).toBe('## Implementation\nStep 1...');
      expect(result!.milestoneId).toBe(milestoneId);
    });
  });

  describe('upsert', () => {
    it('should create plan content for a milestone', async () => {
      const result = await caller.planContent.upsert({
        milestoneId,
        content: 'Initial plan',
      });
      expect(result.content).toBe('Initial plan');
      expect(result.milestoneId).toBe(milestoneId);
    });

    it('should update existing plan content', async () => {
      await caller.planContent.upsert({
        milestoneId,
        content: 'First version',
      });
      const updated = await caller.planContent.upsert({
        milestoneId,
        content: 'Updated version',
      });
      expect(updated.content).toBe('Updated version');

      // Should not create a duplicate
      const result = await caller.planContent.get({ milestoneId });
      expect(result!.content).toBe('Updated version');
    });
  });

  describe('delete', () => {
    it('should delete plan content', async () => {
      await caller.planContent.upsert({
        milestoneId,
        content: 'Delete me',
      });
      await caller.planContent.delete({ milestoneId });
      const result = await caller.planContent.get({ milestoneId });
      expect(result).toBeNull();
    });

    it('should succeed even if no plan content exists', async () => {
      const result = await caller.planContent.delete({ milestoneId });
      expect(result.success).toBe(true);
    });
  });
});
