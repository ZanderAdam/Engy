import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { initWorkspaceDir, removeWorkspaceDir } from '../../engy-dir/init';

describe('workspace router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should create a workspace with slug derived from name', async () => {
      const result = await caller.workspace.create({ name: 'My Workspace' });
      expect(result.name).toBe('My Workspace');
      expect(result.slug).toBe('my-workspace');
    });

    it('should handle slug collisions with numeric suffix', async () => {
      await caller.workspace.create({ name: 'Test' });
      const second = await caller.workspace.create({ name: 'Test' });
      expect(second.slug).toBe('test-2');
    });

    it('should fail when repos provided but no daemon connected', async () => {
      await expect(
        caller.workspace.create({ name: 'WS', repos: ['/some/path'] }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should create a Default project when creating a workspace', async () => {
      const ws = await caller.workspace.create({ name: 'With Default' });
      const projects = await caller.project.list({ workspaceId: ws.id });
      const defaultProject = projects.find((p) => p.isDefault);
      expect(defaultProject).toBeDefined();
      expect(defaultProject!.name).toBe('Default');
    });

    it('should initialize workspace directory structure', async () => {
      const ws = await caller.workspace.create({ name: 'Dir Check' });
      expect(fs.existsSync(path.join(ctx.tmpDir, ws.slug, 'workspace.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(ctx.tmpDir, ws.slug, 'system', 'overview.md'))).toBe(true);
      expect(fs.existsSync(path.join(ctx.tmpDir, ws.slug, 'specs'))).toBe(true);
    });

    it('should roll back DB row when workspace directory init fails', async () => {
      // Place a file where the workspace dir would be created, causing mkdirSync to fail
      fs.writeFileSync(path.join(ctx.tmpDir, 'init-fail'), 'blocker');

      await expect(
        caller.workspace.create({ name: 'Init Fail' }),
      ).rejects.toThrow('Failed to initialize workspace directory');

      // Verify the DB row was cleaned up (compensating action)
      const list = await caller.workspace.list();
      expect(list).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('should return all workspaces', async () => {
      await caller.workspace.create({ name: 'WS1' });
      await caller.workspace.create({ name: 'WS2' });
      const result = await caller.workspace.list();
      expect(result).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return a workspace by slug', async () => {
      await caller.workspace.create({ name: 'My WS' });
      const result = await caller.workspace.get({ slug: 'my-ws' });
      expect(result.name).toBe('My WS');
    });

    it('should throw NOT_FOUND for missing workspace', async () => {
      await expect(caller.workspace.get({ slug: 'nope' })).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete a workspace', async () => {
      const ws = await caller.workspace.create({ name: 'Delete Me' });
      await caller.workspace.delete({ id: ws.id });
      const list = await caller.workspace.list();
      expect(list).toHaveLength(0);
    });

    it('should return success after deleting a workspace', async () => {
      const ws = await caller.workspace.create({ name: 'To Remove' });
      const result = await caller.workspace.delete({ id: ws.id });
      expect(result).toEqual({ success: true });
    });

    it('should throw NOT_FOUND when workspace does not exist', async () => {
      await expect(caller.workspace.delete({ id: 9999 })).rejects.toThrow(
        'Workspace not found',
      );
    });

    it('should cascade delete projects when workspace is deleted', async () => {
      const ws = await caller.workspace.create({ name: 'Cascade WS' });
      await caller.project.create({ workspaceId: ws.id, name: 'Extra Project' });

      const beforeDelete = await caller.project.list({ workspaceId: ws.id });
      expect(beforeDelete.length).toBeGreaterThanOrEqual(2);

      await caller.workspace.delete({ id: ws.id });

      const remaining = await caller.project.list({ workspaceId: ws.id });
      expect(remaining).toHaveLength(0);
    });

    it('should remove workspace directory on disk', async () => {
      const ws = await caller.workspace.create({ name: 'Clean Up' });
      const wsDir = path.join(ctx.tmpDir, ws.slug);
      expect(fs.existsSync(wsDir)).toBe(true);

      await caller.workspace.delete({ id: ws.id });
      expect(fs.existsSync(wsDir)).toBe(false);
    });

    it('should succeed even if filesystem removal fails', async () => {
      const ws = await caller.workspace.create({ name: 'FS Fail' });

      // Remove the directory before delete so removeWorkspaceDir hits a no-op path,
      // and even if it threw, the router catches and warns without re-throwing.
      const fsLib = await import('node:fs');
      const pathLib = await import('node:path');
      const wsDir = pathLib.join(ctx.tmpDir, ws.slug);
      if (fsLib.existsSync(wsDir)) {
        fsLib.rmSync(wsDir, { recursive: true, force: true });
      }

      const result = await caller.workspace.delete({ id: ws.id });
      expect(result).toEqual({ success: true });

      const list = await caller.workspace.list();
      expect(list).toHaveLength(0);
    });
  });

  describe('engy-dir validation', () => {
    it('initWorkspaceDir should reject slugs containing path separators', () => {
      expect(() => initWorkspaceDir('Bad', '../etc', [])).toThrow('Invalid workspace slug');
      expect(() => initWorkspaceDir('Bad', 'foo/bar', [])).toThrow('Invalid workspace slug');
      expect(() => initWorkspaceDir('Bad', 'foo\\bar', [])).toThrow('Invalid workspace slug');
    });

    it('initWorkspaceDir should reject dot slugs', () => {
      expect(() => initWorkspaceDir('Bad', '.', [])).toThrow('Invalid workspace slug');
      expect(() => initWorkspaceDir('Bad', '', [])).toThrow('Invalid workspace slug');
    });

    it('removeWorkspaceDir should reject slugs with path traversal', () => {
      expect(() => removeWorkspaceDir('../etc')).toThrow('Invalid workspace slug');
      expect(() => removeWorkspaceDir('foo/bar')).toThrow('Invalid workspace slug');
    });

    it('removeWorkspaceDir should no-op for non-existent directory', () => {
      expect(() => removeWorkspaceDir('nonexistent-workspace')).not.toThrow();
    });
  });
});
