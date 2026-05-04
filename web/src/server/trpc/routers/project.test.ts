import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { getDb } from '../../db/client';
import { tasks } from '../../db/schema';

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
    it('should create a project with filesystem directory', async () => {
      const result = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'Auth Feature',
      });
      expect(result.name).toBe('Auth Feature');
      expect(result.slug).toBe('auth-feature');
      expect(result.projectDir).toBe('auth-feature');
      expect(result.status).toBe('planning');
    });

    it('should reject unknown workspace', async () => {
      await expect(
        caller.project.create({ workspaceSlug: 'nope', name: 'X' }),
      ).rejects.toThrow('not found');
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
        workspaceSlug: 'test-ws',
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

  describe('getBySlug', () => {
    it('should return a project by workspaceId and slug', async () => {
      const proj = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'Auth Feature',
      });
      const result = await caller.project.getBySlug({
        workspaceId,
        slug: 'auth-feature',
      });
      expect(result.id).toBe(proj.id);
      expect(result.name).toBe('Auth Feature');
      expect(result.planSlugs).toEqual([]);
    });

    it('should include plan slugs from the plans dir', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Has Plans' });
      const plansDir = path.join(ctx.tmpDir, 'test-ws', 'projects', 'has-plans', 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(path.join(plansDir, 'test-ws-T1.plan.md'), '# plan');
      fs.writeFileSync(path.join(plansDir, 'README.md'), 'ignored');
      const result = await caller.project.getBySlug({ workspaceId, slug: 'has-plans' });
      expect(result.planSlugs).toEqual(['test-ws-T1']);
    });

    it('should throw NOT_FOUND for non-existent slug', async () => {
      await expect(
        caller.project.getBySlug({ workspaceId, slug: 'nope' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('getPlanSlugs', () => {
    it('should return empty plan list and workspace slug when no plans dir exists', async () => {
      const proj = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'No Plans',
      });
      const result = await caller.project.getPlanSlugs({ projectId: proj.id });
      expect(result).toEqual({ workspaceSlug: 'test-ws', planSlugs: [] });
    });

    it('should list slugs from plans dir, ignoring non-plan files', async () => {
      const proj = await caller.project.create({ workspaceSlug: 'test-ws', name: 'Plans Here' });
      const plansDir = path.join(ctx.tmpDir, 'test-ws', 'projects', 'plans-here', 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(path.join(plansDir, 'test-ws-T1.plan.md'), '# plan');
      fs.writeFileSync(path.join(plansDir, 'test-ws-T2.plan.md'), '# plan');
      fs.writeFileSync(path.join(plansDir, 'notes.md'), 'ignored');
      const result = await caller.project.getPlanSlugs({ projectId: proj.id });
      expect(result.workspaceSlug).toBe('test-ws');
      expect(result.planSlugs.sort()).toEqual(['test-ws-T1', 'test-ws-T2']);
    });

    it('should throw NOT_FOUND for unknown project', async () => {
      await expect(caller.project.getPlanSlugs({ projectId: 9999 })).rejects.toThrow('not found');
    });
  });

  describe('listWithProgress', () => {
    it('should return projects with task progress counts', async () => {
      const proj = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'Progress Test',
      });

      await caller.task.create({ projectId: proj.id, title: 'T1' });
      const t2 = await caller.task.create({ projectId: proj.id, title: 'T2' });
      await caller.task.update({ id: t2.id, status: 'done' });

      const result = await caller.project.listWithProgress({ workspaceId });
      const p = result.find((r) => r.id === proj.id);
      expect(p).toBeDefined();
      expect(p!.taskCount).toBe(2);
      expect(p!.completedTasks).toBe(1);
    });

    it('should return zero counts for project with no tasks', async () => {
      const proj = await caller.project.create({
        workspaceSlug: 'test-ws',
        name: 'Empty Project',
      });
      const result = await caller.project.listWithProgress({ workspaceId });
      const p = result.find((r) => r.id === proj.id);
      expect(p).toBeDefined();
      expect(p!.taskCount).toBe(0);
      expect(p!.completedTasks).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('should update project status', async () => {
      const proj = await caller.project.create({ workspaceSlug: 'test-ws', name: 'Status Test' });
      const updated = await caller.project.updateStatus({ id: proj.id, status: 'active' });
      expect(updated.status).toBe('active');
    });

    it('should allow valid forward transitions', async () => {
      const proj = await caller.project.create({ workspaceSlug: 'test-ws', name: 'Forward Test' });
      await caller.project.updateStatus({ id: proj.id, status: 'active' });
      await caller.project.updateStatus({ id: proj.id, status: 'completing' });
      const result = await caller.project.updateStatus({ id: proj.id, status: 'archived' });
      expect(result.status).toBe('archived');
    });

    it('should allow any valid status transition', async () => {
      const proj = await caller.project.create({ workspaceSlug: 'test-ws', name: 'Any Test' });
      await caller.project.updateStatus({ id: proj.id, status: 'archived' });
      const result = await caller.project.updateStatus({ id: proj.id, status: 'planning' });
      expect(result.status).toBe('planning');
    });

    it('should throw NOT_FOUND for non-existent project', async () => {
      await expect(
        caller.project.updateStatus({ id: 9999, status: 'active' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete a project', async () => {
      const proj = await caller.project.create({ workspaceSlug: 'test-ws', name: 'Delete Me' });
      await caller.project.delete({ id: proj.id });
      await expect(caller.project.get({ id: proj.id })).rejects.toThrow('not found');
    });
  });

  // ── Spec file procedures ─────────────────────────────────────────

  describe('listFiles', () => {
    it('should return files for a project', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
      const result = await caller.project.listFiles({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
      });
      expect(result.files).toContainEqual(
        expect.objectContaining({ path: 'spec.md', mtime: expect.any(Number) }),
      );
    });

    it('should return empty files for unknown project', async () => {
      await expect(
        caller.project.listFiles({ workspaceSlug: 'test-ws', projectSlug: 'missing' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('getSpec', () => {
    it('should return spec content', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
      const spec = await caller.project.getSpec({ workspaceSlug: 'test-ws', projectSlug: 'auth' });
      expect(spec.frontmatter.type).toBe('buildable');
      expect(spec.frontmatter.status).toBe('draft');
    });

    it('should throw NOT_FOUND for missing project', async () => {
      await expect(
        caller.project.getSpec({ workspaceSlug: 'test-ws', projectSlug: 'missing' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('updateSpec', () => {
    it('should update spec body', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
      await caller.project.updateSpec({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        body: 'New content',
      });
      const spec = await caller.project.getSpec({ workspaceSlug: 'test-ws', projectSlug: 'auth' });
      expect(spec.body).toBe('New content');
    });

    it('should reject invalid status transition', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
      await expect(
        caller.project.updateSpec({
          workspaceSlug: 'test-ws',
          projectSlug: 'auth',
          status: 'approved',
        }),
      ).rejects.toThrow('Invalid status transition');
    });

    it('should block draft → ready with incomplete tasks', async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'auth', status: 'todo' }).run();

      await expect(
        caller.project.updateSpec({
          workspaceSlug: 'test-ws',
          projectSlug: 'auth',
          status: 'ready',
        }),
      ).rejects.toThrow('incomplete tasks');
    });
  });

  describe('context files', () => {
    beforeEach(async () => {
      await caller.project.create({ workspaceSlug: 'test-ws', name: 'Auth' });
    });

    it('should write and read context files', async () => {
      await caller.project.writeContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'notes.md',
        content: 'Research notes',
      });

      const content = await caller.project.readContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'notes.md',
      });
      expect(content).toBe('Research notes');
    });

    it('should list context files', async () => {
      await caller.project.writeContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'notes.md',
        content: 'data',
      });
      await caller.project.writeContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'api.yaml',
        content: 'data',
      });

      const files = await caller.project.listContextFiles({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
      });
      expect(files).toEqual(['api.yaml', 'notes.md']);
    });

    it('should delete context file', async () => {
      await caller.project.writeContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'notes.md',
        content: 'data',
      });
      await caller.project.deleteContextFile({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
        filename: 'notes.md',
      });
      const files = await caller.project.listContextFiles({
        workspaceSlug: 'test-ws',
        projectSlug: 'auth',
      });
      expect(files).toEqual([]);
    });
  });
});
