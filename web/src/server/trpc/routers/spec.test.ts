import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { getDb } from '../../db/client';
import { tasks } from '../../db/schema';

describe('spec router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    await caller.workspace.create({ name: 'Test WS' });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a buildable spec', async () => {
      const spec = await caller.spec.create({
        workspaceSlug: 'test-ws',
        title: 'Auth',
        type: 'buildable',
      });
      expect(spec.name).toBe('1_auth');
      expect(spec.type).toBe('buildable');
      expect(spec.status).toBe('draft');
    });

    it('should create a vision spec', async () => {
      const spec = await caller.spec.create({
        workspaceSlug: 'test-ws',
        title: 'Platform Vision',
        type: 'vision',
      });
      expect(spec.name).toBe('platform-vision');
      expect(spec.type).toBe('vision');
    });

    it('should reject unknown workspace', async () => {
      await expect(
        caller.spec.create({ workspaceSlug: 'nope', title: 'X' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    it('should return empty array for workspace with no specs', async () => {
      const specs = await caller.spec.list({ workspaceSlug: 'test-ws' });
      expect(specs).toEqual([]);
    });

    it('should list created specs', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Vision', type: 'vision' });
      const specs = await caller.spec.list({ workspaceSlug: 'test-ws' });
      expect(specs).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return spec content', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      const spec = await caller.spec.get({ workspaceSlug: 'test-ws', specSlug: '1_auth' });
      expect(spec.frontmatter.title).toBe('Auth');
      expect(spec.body).toContain('# Auth');
    });

    it('should throw NOT_FOUND for missing spec', async () => {
      await expect(
        caller.spec.get({ workspaceSlug: 'test-ws', specSlug: 'missing' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should update spec body', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      await caller.spec.update({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        body: 'New content',
      });
      const spec = await caller.spec.get({ workspaceSlug: 'test-ws', specSlug: '1_auth' });
      expect(spec.body).toBe('New content');
    });

    it('should reject invalid status transition', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      await expect(
        caller.spec.update({
          workspaceSlug: 'test-ws',
          specSlug: '1_auth',
          status: 'approved',
        }),
      ).rejects.toThrow('Invalid status transition');
    });

    it('should block draft → ready with incomplete tasks', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: '1_auth', status: 'todo' }).run();

      await expect(
        caller.spec.update({
          workspaceSlug: 'test-ws',
          specSlug: '1_auth',
          status: 'ready',
        }),
      ).rejects.toThrow('incomplete tasks');
    });
  });

  describe('delete', () => {
    it('should delete a spec', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      await caller.spec.delete({ workspaceSlug: 'test-ws', specSlug: '1_auth' });
      const specs = await caller.spec.list({ workspaceSlug: 'test-ws' });
      expect(specs).toHaveLength(0);
    });

    it('should cascade-delete tasks', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: '1_auth', status: 'todo' }).run();

      await caller.spec.delete({ workspaceSlug: 'test-ws', specSlug: '1_auth' });
      const remaining = db.select().from(tasks).all();
      expect(remaining).toHaveLength(0);
    });

    it('should throw NOT_FOUND for missing spec', async () => {
      await expect(
        caller.spec.delete({ workspaceSlug: 'test-ws', specSlug: 'missing' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('createProject', () => {
    it('should create a project from an approved spec', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth Revamp', type: 'buildable' });
      await caller.spec.update({ workspaceSlug: 'test-ws', specSlug: '1_auth_revamp', status: 'ready' });
      await caller.spec.update({ workspaceSlug: 'test-ws', specSlug: '1_auth_revamp', status: 'approved' });

      const project = await caller.spec.createProject({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth_revamp',
      });

      expect(project.name).toBe('Auth Revamp');
      expect(project.status).toBe('planning');
      expect(project.specPath).toBe('1_auth_revamp');

      // Spec status should be updated to active
      const spec = await caller.spec.get({ workspaceSlug: 'test-ws', specSlug: '1_auth_revamp' });
      expect(spec.frontmatter.status).toBe('active');
    });

    it('should reject creating project from non-approved spec', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Draft Spec', type: 'buildable' });
      await expect(
        caller.spec.createProject({ workspaceSlug: 'test-ws', specSlug: '1_draft_spec' }),
      ).rejects.toThrow('spec must be in approved status');
    });

    it('should reject creating project from spec that already has a project', async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Already Used', type: 'buildable' });
      await caller.spec.update({ workspaceSlug: 'test-ws', specSlug: '1_already_used', status: 'ready' });
      await caller.spec.update({ workspaceSlug: 'test-ws', specSlug: '1_already_used', status: 'approved' });
      await caller.spec.createProject({ workspaceSlug: 'test-ws', specSlug: '1_already_used' });

      // Try creating again — spec is now 'active'
      await expect(
        caller.spec.createProject({ workspaceSlug: 'test-ws', specSlug: '1_already_used' }),
      ).rejects.toThrow('spec must be in approved status');
    });
  });

  describe('context files', () => {
    beforeEach(async () => {
      await caller.spec.create({ workspaceSlug: 'test-ws', title: 'Auth', type: 'buildable' });
    });

    it('should write and read context files', async () => {
      await caller.spec.writeContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'notes.md',
        content: 'Research notes',
      });

      const content = await caller.spec.readContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'notes.md',
      });
      expect(content).toBe('Research notes');
    });

    it('should list context files', async () => {
      await caller.spec.writeContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'notes.md',
        content: 'data',
      });
      await caller.spec.writeContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'api.yaml',
        content: 'data',
      });

      const files = await caller.spec.listContextFiles({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
      });
      expect(files).toEqual(['api.yaml', 'notes.md']);
    });

    it('should delete context file', async () => {
      await caller.spec.writeContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'notes.md',
        content: 'data',
      });
      await caller.spec.deleteContextFile({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
        filename: 'notes.md',
      });
      const files = await caller.spec.listContextFiles({
        workspaceSlug: 'test-ws',
        specSlug: '1_auth',
      });
      expect(files).toEqual([]);
    });
  });
});
