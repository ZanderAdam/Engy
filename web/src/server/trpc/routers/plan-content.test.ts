import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('planContent router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let milestoneId: number;
  let projectId: number;
  let workspaceSlug: string;
  let projectSlug: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Plan WS' });
    workspaceSlug = ws.slug;

    projectSlug = 'plan-project';
    const proj = await caller.project.create({
      workspaceSlug,
      name: 'Plan Project',
    });
    projectId = proj.id;
    const milestone = await caller.milestone.create({
      projectId: proj.id,
      title: 'Setup',
      sortOrder: 0,
    });
    milestoneId = milestone.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('get', () => {
    it('should return null for milestone with no plan file', async () => {
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

    it('should return null for project without projectDir', async () => {
      const ws = await caller.workspace.create({ name: 'No Dir WS' });
      // Default project has no projectDir
      const defaultProjs = await caller.project.list({ workspaceId: ws.id });
      const defaultProj = defaultProjs.find((p) => p.isDefault)!;
      const ms = await caller.milestone.create({
        projectId: defaultProj.id,
        title: 'M1',
      });
      const result = await caller.planContent.get({ milestoneId: ms.id });
      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('should write plan content to filesystem', async () => {
      const result = await caller.planContent.upsert({
        milestoneId,
        content: 'Initial plan',
      });
      expect(result.content).toBe('Initial plan');
      expect(result.milestoneId).toBe(milestoneId);

      // Verify file exists on disk under projects/
      const filePath = path.join(
        ctx.tmpDir,
        workspaceSlug,
        'projects',
        projectSlug,
        'm1-setup.plan.md',
      );
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Initial plan');
    });

    it('should overwrite existing plan content', async () => {
      await caller.planContent.upsert({ milestoneId, content: 'First version' });
      const updated = await caller.planContent.upsert({ milestoneId, content: 'Updated version' });
      expect(updated.content).toBe('Updated version');

      const result = await caller.planContent.get({ milestoneId });
      expect(result!.content).toBe('Updated version');
    });

    it('should return message for project without projectDir', async () => {
      const ws = await caller.workspace.create({ name: 'Bare WS' });
      const defaultProjs = await caller.project.list({ workspaceId: ws.id });
      const defaultProj = defaultProjs.find((p) => p.isDefault)!;
      const ms = await caller.milestone.create({ projectId: defaultProj.id, title: 'M1' });
      const result = await caller.planContent.upsert({ milestoneId: ms.id, content: 'Content' });
      expect(result.message).toBe('no projectDir');
    });
  });

  describe('delete', () => {
    it('should delete plan file from filesystem', async () => {
      await caller.planContent.upsert({ milestoneId, content: 'Delete me' });
      await caller.planContent.delete({ milestoneId });
      const result = await caller.planContent.get({ milestoneId });
      expect(result).toBeNull();
    });

    it('should succeed even if no plan file exists', async () => {
      const result = await caller.planContent.delete({ milestoneId });
      expect(result.success).toBe(true);
    });
  });

  describe('list', () => {
    it('should return empty array when no plan files exist', async () => {
      const result = await caller.planContent.list({ projectId });
      expect(result).toEqual([]);
    });

    it('should return sorted plan files', async () => {
      await caller.planContent.upsert({ milestoneId, content: 'Plan 1' });

      const ms2 = await caller.milestone.create({ projectId, title: 'Auth', sortOrder: 1 });
      await caller.planContent.upsert({ milestoneId: ms2.id, content: 'Plan 2' });

      const result = await caller.planContent.list({ projectId });
      expect(result).toEqual(['m1-setup.plan.md', 'm2-auth.plan.md']);
    });

    it('should return empty array for project without projectDir', async () => {
      const ws = await caller.workspace.create({ name: 'List WS' });
      const defaultProjs = await caller.project.list({ workspaceId: ws.id });
      const defaultProj = defaultProjs.find((p) => p.isDefault)!;
      const result = await caller.planContent.list({ projectId: defaultProj.id });
      expect(result).toEqual([]);
    });
  });
});
