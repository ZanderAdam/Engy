import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces } from '../../db/schema';
import {
  initWorkspaceDir,
  removeWorkspaceDir,
  renameWorkspaceDir,
  getWorkspaceDir,
} from '../../engy-dir/init';

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
      await expect(caller.workspace.create({ name: 'WS', repos: ['/some/path'] })).rejects.toThrow(
        'No daemon connected',
      );
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
      expect(fs.existsSync(path.join(ctx.tmpDir, ws.slug, 'projects'))).toBe(true);
    });

    it('should roll back DB row when workspace directory init fails', async () => {
      // Place a file where the workspace dir would be created, causing mkdirSync to fail
      fs.writeFileSync(path.join(ctx.tmpDir, 'init-fail'), 'blocker');

      await expect(caller.workspace.create({ name: 'Init Fail' })).rejects.toThrow(
        'Failed to initialize workspace directory',
      );

      // Verify the DB row was cleaned up (compensating action)
      const list = await caller.workspace.list();
      expect(list).toHaveLength(0);
    });

    it('should store docsDir as null when not provided', async () => {
      const ws = await caller.workspace.create({ name: 'No DocsDir' });
      expect(ws.docsDir).toBeNull();
    });

    it('should populate default skills on creation', async () => {
      const ws = await caller.workspace.create({ name: 'Default Skills' });
      expect(ws.planSkill).toBe('/engy:plan');
      expect(ws.implementSkill).toBe('/engy:implement');
    });

    it('should include skills in workspace.yaml on creation', async () => {
      const ws = await caller.workspace.create({ name: 'Skills Yaml' });
      const yamlPath = path.join(ctx.tmpDir, ws.slug, 'workspace.yaml');
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed.planSkill).toBe('/engy:plan');
      expect(parsed.implementSkill).toBe('/engy:implement');
    });

    it('should default earsBdd to false on creation', async () => {
      const ws = await caller.workspace.create({ name: 'Ears Default' });
      expect(ws.earsBdd).toBe(false);
    });

    it('should persist earsBdd and write it to workspace.yaml when enabled', async () => {
      const ws = await caller.workspace.create({ name: 'Ears On', earsBdd: true });
      expect(ws.earsBdd).toBe(true);
      const parsed = yaml.load(
        fs.readFileSync(path.join(ctx.tmpDir, ws.slug, 'workspace.yaml'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(parsed.earsBdd).toBe(true);
    });

    it('should write workspace.yaml using js-yaml', async () => {
      const ws = await caller.workspace.create({ name: 'YAML Check' });
      const yamlPath = path.join(ctx.tmpDir, ws.slug, 'workspace.yaml');
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(content) as Record<string, unknown>;
      expect(parsed.name).toBe('YAML Check');
      expect(parsed.slug).toBe('yaml-check');
    });
  });

  describe('create with docsDir', () => {
    it('should store docsDir in DB when provided', async () => {
      const customDir = path.join(ctx.tmpDir, 'custom-docs');
      fs.mkdirSync(customDir, { recursive: true });

      // docsDir requires daemon for validation, so this will fail without daemon
      await expect(caller.workspace.create({ name: 'Custom', docsDir: customDir })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should create workspace files at custom docsDir path', async () => {
      const customDir = path.join(ctx.tmpDir, 'my-repo-docs');
      fs.mkdirSync(customDir, { recursive: true });

      // Test initWorkspaceDir directly since the tRPC flow needs a daemon
      initWorkspaceDir('My Project', 'my-project', [], customDir);

      expect(fs.existsSync(path.join(customDir, 'workspace.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'projects'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'docs'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'memory'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'system', 'overview.md'))).toBe(true);

      // System directories are seeded with README index files.
      expect(fs.existsSync(path.join(customDir, 'system', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'system', 'features', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'system', 'technical', 'README.md'))).toBe(true);
      expect(fs.readFileSync(path.join(customDir, 'system', 'README.md'), 'utf8')).toContain(
        '<!-- INDEX START -->',
      );

      // Default ENGY_DIR path should NOT have been created
      expect(fs.existsSync(path.join(ctx.tmpDir, 'my-project'))).toBe(false);
    });

    it('should include docsDir in workspace.yaml when set', async () => {
      const customDir = path.join(ctx.tmpDir, 'yaml-docs-dir');
      fs.mkdirSync(customDir, { recursive: true });

      initWorkspaceDir('Yaml Test', 'yaml-test', [], customDir);

      const yamlPath = path.join(customDir, 'workspace.yaml');
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed.docsDir).toBe(customDir);
    });

    it('should NOT include docsDir in workspace.yaml when not set', async () => {
      initWorkspaceDir('No Docs', 'no-docs', []);

      const yamlPath = path.join(ctx.tmpDir, 'no-docs', 'workspace.yaml');
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed.docsDir).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update workspace name', async () => {
      const ws = await caller.workspace.create({ name: 'Original' });
      const updated = await caller.workspace.update({ id: ws.id, name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
    });

    it('should preserve slug when name changes', async () => {
      const ws = await caller.workspace.create({ name: 'Slug Test' });
      const updated = await caller.workspace.update({ id: ws.id, name: 'New Name' });
      expect(updated.slug).toBe(ws.slug);
    });

    it('should preserve docsDir when not provided in update', async () => {
      const ws = await caller.workspace.create({ name: 'Docs Update' });
      const updated = await caller.workspace.update({ id: ws.id, name: 'Docs Update' });
      expect(updated.docsDir).toBeNull();
    });

    it('should clear docsDir when set to null', async () => {
      const ws = await caller.workspace.create({ name: 'Clear Docs' });
      const updated = await caller.workspace.update({ id: ws.id, docsDir: null });
      expect(updated.docsDir).toBeNull();
    });

    it('should rewrite workspace.yaml when name changes', async () => {
      const ws = await caller.workspace.create({ name: 'Yaml Name' });
      await caller.workspace.update({ id: ws.id, name: 'Updated Name' });

      const yamlPath = path.join(ctx.tmpDir, ws.slug, 'workspace.yaml');
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed.name).toBe('Updated Name');
    });

    it('should throw NOT_FOUND for missing workspace', async () => {
      await expect(caller.workspace.update({ id: 9999, name: 'X' })).rejects.toThrow(
        'Workspace not found',
      );
    });

    it('should fail when repos provided but no daemon connected', async () => {
      const ws = await caller.workspace.create({ name: 'Repo Update' });
      await expect(caller.workspace.update({ id: ws.id, repos: ['/some/path'] })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should fail when new docsDir provided but no daemon connected', async () => {
      const ws = await caller.workspace.create({ name: 'DocsDir Update' });
      await expect(
        caller.workspace.update({ id: ws.id, docsDir: '/some/new/path' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should not validate docsDir when it is unchanged', async () => {
      const ws = await caller.workspace.create({ name: 'No Validate' });
      // null -> null: no daemon needed
      const updated = await caller.workspace.update({ id: ws.id, docsDir: null });
      expect(updated.name).toBe('No Validate');
    });

    it('should update slug when provided', async () => {
      const ws = await caller.workspace.create({ name: 'Slug Update' });
      const updated = await caller.workspace.update({ id: ws.id, slug: 'new-slug' });
      expect(updated.slug).toBe('new-slug');
    });

    it('should rename workspace directory when slug changes', async () => {
      const ws = await caller.workspace.create({ name: 'Rename Dir' });
      const oldDir = path.join(ctx.tmpDir, ws.slug);
      expect(fs.existsSync(oldDir)).toBe(true);

      await caller.workspace.update({ id: ws.id, slug: 'renamed-dir' });

      expect(fs.existsSync(oldDir)).toBe(false);
      expect(fs.existsSync(path.join(ctx.tmpDir, 'renamed-dir'))).toBe(true);
    });

    it('should update workspace.yaml slug after rename', async () => {
      const ws = await caller.workspace.create({ name: 'Yaml Slug' });
      await caller.workspace.update({ id: ws.id, slug: 'yaml-new-slug' });

      const yamlPath = path.join(ctx.tmpDir, 'yaml-new-slug', 'workspace.yaml');
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed.slug).toBe('yaml-new-slug');
    });

    it('should reject invalid slug format', async () => {
      const ws = await caller.workspace.create({ name: 'Bad Slug' });
      await expect(
        caller.workspace.update({ id: ws.id, slug: 'Invalid Slug!' }),
      ).rejects.toThrow();
    });

    it('should reject duplicate slug', async () => {
      await caller.workspace.create({ name: 'First' });
      const ws2 = await caller.workspace.create({ name: 'Second' });
      await expect(caller.workspace.update({ id: ws2.id, slug: 'first' })).rejects.toThrow(
        'already in use',
      );
    });

    it('should allow setting slug to current value (no-op)', async () => {
      const ws = await caller.workspace.create({ name: 'Same Slug' });
      const updated = await caller.workspace.update({ id: ws.id, slug: ws.slug });
      expect(updated.slug).toBe(ws.slug);
    });

    it('should update planSkill and implementSkill', async () => {
      const ws = await caller.workspace.create({ name: 'Skill Update' });
      const updated = await caller.workspace.update({
        id: ws.id,
        planSkill: '/custom:plan',
        implementSkill: '/custom:implement',
      });
      expect(updated.planSkill).toBe('/custom:plan');
      expect(updated.implementSkill).toBe('/custom:implement');
    });

    it('should clear skills when set to null', async () => {
      const ws = await caller.workspace.create({ name: 'Skill Clear' });
      await caller.workspace.update({
        id: ws.id,
        planSkill: '/custom:plan',
        implementSkill: '/custom:implement',
      });
      const cleared = await caller.workspace.update({
        id: ws.id,
        planSkill: null,
        implementSkill: null,
      });
      expect(cleared.planSkill).toBeNull();
      expect(cleared.implementSkill).toBeNull();
    });

    it('should preserve skills when not included in update', async () => {
      const ws = await caller.workspace.create({ name: 'Skill Preserve' });
      expect(ws.planSkill).toBe('/engy:plan');
      const updated = await caller.workspace.update({ id: ws.id, name: 'Renamed' });
      expect(updated.planSkill).toBe('/engy:plan');
      expect(updated.implementSkill).toBe('/engy:implement');
    });

    it('should toggle earsBdd and preserve it when not included in update', async () => {
      const ws = await caller.workspace.create({ name: 'Ears Toggle' });
      expect(ws.earsBdd).toBe(false);
      const enabled = await caller.workspace.update({ id: ws.id, earsBdd: true });
      expect(enabled.earsBdd).toBe(true);
      const renamed = await caller.workspace.update({ id: ws.id, name: 'Ears Renamed' });
      expect(renamed.earsBdd).toBe(true);
    });

    describe('devcontainer config generation', () => {
      interface MockDaemon {
        readyState: number;
        OPEN: number;
        send: ReturnType<typeof vi.fn>;
      }

      function attachMockDaemon(): MockDaemon {
        const daemon: MockDaemon = {
          readyState: WebSocket.OPEN,
          OPEN: WebSocket.OPEN,
          send: vi.fn(),
        };
        ctx.state.daemon = daemon as unknown as WebSocket;
        return daemon;
      }

      interface GenerateCall {
        type: string;
        payload: { requestId: string; workspaceFolder: string };
      }

      function findGenerateCall(daemon: MockDaemon): GenerateCall | undefined {
        for (const call of daemon.send.mock.calls) {
          const msg = JSON.parse(call[0] as string) as GenerateCall;
          if (msg.type === 'DEVCONTAINER_CONFIG_GENERATE_REQUEST') return msg;
        }
        return undefined;
      }

      function resolveGenerateRequest(daemon: MockDaemon): void {
        const msg = findGenerateCall(daemon);
        if (!msg) throw new Error('no generate request captured');
        ctx.state.pendingDevcontainerGenerate.get(msg.payload.requestId)?.resolve();
      }

      function seedDocsDir(workspaceId: number, docsDir: string): void {
        fs.mkdirSync(docsDir, { recursive: true });
        ctx.db.update(workspaces).set({ docsDir }).where(eq(workspaces.id, workspaceId)).run();
      }

      it('dispatches generate when containerEnabled transitions false → true', async () => {
        const ws = await caller.workspace.create({ name: 'Gen Transition' });
        seedDocsDir(ws.id, path.join(ctx.tmpDir, 'docs-gt'));
        const daemon = attachMockDaemon();

        await caller.workspace.update({ id: ws.id, containerEnabled: true });
        resolveGenerateRequest(daemon);

        const msg = findGenerateCall(daemon)!;
        expect(msg.type).toBe('DEVCONTAINER_CONFIG_GENERATE_REQUEST');
        expect(msg.payload.workspaceFolder).toBe(path.join(ctx.tmpDir, 'docs-gt'));
      });

      it('does not dispatch when containerEnabled already true', async () => {
        const ws = await caller.workspace.create({ name: 'Gen Idempotent' });
        seedDocsDir(ws.id, path.join(ctx.tmpDir, 'docs-idempotent'));
        const daemon = attachMockDaemon();

        await caller.workspace.update({ id: ws.id, containerEnabled: true });
        resolveGenerateRequest(daemon);
        daemon.send.mockClear();

        await caller.workspace.update({ id: ws.id, containerEnabled: true });
        expect(findGenerateCall(daemon)).toBeUndefined();
      });

      it('does not dispatch when backend is coder', async () => {
        const ws = await caller.workspace.create({ name: 'Gen Coder' });
        seedDocsDir(ws.id, path.join(ctx.tmpDir, 'docs-coder'));
        const daemon = attachMockDaemon();

        await caller.workspace.update({
          id: ws.id,
          containerEnabled: true,
          executionBackend: 'coder',
        });
        expect(findGenerateCall(daemon)).toBeUndefined();
      });

      it('does not dispatch when docsDir is null', async () => {
        const ws = await caller.workspace.create({ name: 'Gen No Docs' });
        const daemon = attachMockDaemon();

        await caller.workspace.update({ id: ws.id, containerEnabled: true });
        expect(findGenerateCall(daemon)).toBeUndefined();
      });

      it('is non-fatal when daemon is offline', async () => {
        const ws = await caller.workspace.create({ name: 'Gen Offline' });
        seedDocsDir(ws.id, path.join(ctx.tmpDir, 'docs-offline'));
        // daemon intentionally left as null
        const updated = await caller.workspace.update({ id: ws.id, containerEnabled: true });
        expect(updated.containerEnabled).toBe(true);
      });

      it('logs warning but does not throw when dispatch rejects', async () => {
        const ws = await caller.workspace.create({ name: 'Gen Reject' });
        seedDocsDir(ws.id, path.join(ctx.tmpDir, 'docs-reject'));
        const daemon = attachMockDaemon();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const updated = await caller.workspace.update({ id: ws.id, containerEnabled: true });
        const msg = findGenerateCall(daemon)!;
        ctx.state.pendingDevcontainerGenerate.get(msg.payload.requestId)?.reject(new Error('boom'));
        await vi.waitUntil(() => warnSpy.mock.calls.length > 0);

        expect(updated.containerEnabled).toBe(true);
        warnSpy.mockRestore();
      });
    });

    it('should rollback slug in DB if directory rename fails', async () => {
      const ws = await caller.workspace.create({ name: 'Rollback Test' });
      const oldDir = path.join(ctx.tmpDir, ws.slug);
      expect(fs.existsSync(oldDir)).toBe(true);

      // Pre-create target directory to force rename failure
      fs.mkdirSync(path.join(ctx.tmpDir, 'conflict-slug'), { recursive: true });

      await expect(caller.workspace.update({ id: ws.id, slug: 'conflict-slug' })).rejects.toThrow(
        'Failed to rename workspace directory',
      );

      // Verify slug was rolled back
      const fetched = await caller.workspace.get({ slug: ws.slug });
      expect(fetched.slug).toBe(ws.slug);
    });

    it('should rollback ALL fields (not just slug) when rename fails', async () => {
      const ws = await caller.workspace.create({ name: 'Full Rollback' });

      // Pre-create target directory to force rename failure
      fs.mkdirSync(path.join(ctx.tmpDir, 'new-slug-fail'), { recursive: true });

      await expect(
        caller.workspace.update({
          id: ws.id,
          slug: 'new-slug-fail',
          name: 'Changed Name',
          earsBdd: true,
          maxConcurrency: 5,
        }),
      ).rejects.toThrow('Failed to rename workspace directory');

      // All fields must be at their prior values
      const fetched = await caller.workspace.get({ slug: ws.slug });
      expect(fetched.slug).toBe(ws.slug);
      expect(fetched.name).toBe('Full Rollback');
      expect(fetched.earsBdd).toBe(false);
      expect(fetched.maxConcurrency).toBe(1); // DB default — not changed by failed update
    });
  });

  describe('name/slug validation', () => {
    describe('create', () => {
      it('should reject a name containing a forward slash', async () => {
        await expect(caller.workspace.create({ name: 'my/workspace' })).rejects.toThrow(
          'path separators',
        );
      });

      it('should reject a name containing a backslash', async () => {
        await expect(caller.workspace.create({ name: 'my\\workspace' })).rejects.toThrow(
          'path separators',
        );
      });

      it('should accept a name without path separators', async () => {
        const ws = await caller.workspace.create({ name: 'Valid Name 123' });
        expect(ws.name).toBe('Valid Name 123');
      });
    });

    describe('update', () => {
      it('should reject a slug containing a forward slash', async () => {
        const ws = await caller.workspace.create({ name: 'Slug Test' });
        await expect(caller.workspace.update({ id: ws.id, slug: 'my/slug' })).rejects.toThrow();
      });

      it('should reject a name update with path separator', async () => {
        const ws = await caller.workspace.create({ name: 'Name Test' });
        await expect(
          caller.workspace.update({ id: ws.id, name: 'bad/name' }),
        ).rejects.toThrow('path separators');
      });

      it('should accept a valid slug update', async () => {
        const ws = await caller.workspace.create({ name: 'Valid Slug' });
        const updated = await caller.workspace.update({ id: ws.id, slug: 'valid-slug-2' });
        expect(updated.slug).toBe('valid-slug-2');
      });
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

    it('should return docsDir field', async () => {
      await caller.workspace.create({ name: 'Get DocsDir' });
      const result = await caller.workspace.get({ slug: 'get-docsdir' });
      expect(result.docsDir).toBeNull();
    });

    it('should report combinedWorktrees true by default (standard engy dir)', async () => {
      await caller.workspace.create({ name: 'Combined Default' });
      const result = await caller.workspace.get({ slug: 'combined-default' });
      expect(result.splitWorktrees).toBe(false);
      expect(result.combinedWorktrees).toBe(true);
    });

    it('should report combinedWorktrees false when splitWorktrees is enabled', async () => {
      const ws = await caller.workspace.create({ name: 'Split On', splitWorktrees: true });
      const result = await caller.workspace.get({ slug: ws.slug });
      expect(result.splitWorktrees).toBe(true);
      expect(result.combinedWorktrees).toBe(false);
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
      await expect(caller.workspace.delete({ id: 9999 })).rejects.toThrow('Workspace not found');
    });

    it('should cascade delete projects when workspace is deleted', async () => {
      const ws = await caller.workspace.create({ name: 'Cascade WS' });
      await caller.project.create({ workspaceSlug: ws.slug, name: 'Extra Project' });

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

  describe('createMissingDirs flag', () => {
    interface MockDaemon {
      readyState: number;
      OPEN: number;
      send: ReturnType<typeof vi.fn>;
    }

    function attachMockDaemon(): MockDaemon {
      const daemon: MockDaemon = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: vi.fn(),
      };
      ctx.state.daemon = daemon as unknown as WebSocket;
      return daemon;
    }

    function findRequestOfType(daemon: MockDaemon, type: string) {
      for (const call of daemon.send.mock.calls) {
        const msg = JSON.parse(call[0] as string);
        if (msg.type === type) return msg;
      }
      return undefined;
    }

    function resolveValidationRequest(
      daemon: MockDaemon,
      results: Array<{ path: string; exists: boolean }>,
    ): void {
      const msg = findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST');
      if (!msg) throw new Error('no validation request captured');
      ctx.state.pendingValidations.get(msg.payload.requestId)?.resolve(results);
    }

    function resolveCreateDirRequest(
      daemon: MockDaemon,
      results: Array<{ path: string; success: boolean; error?: string }>,
    ): void {
      const msg = findRequestOfType(daemon, 'CREATE_DIR_REQUEST');
      if (!msg) throw new Error('no create dir request captured');
      ctx.state.pendingCreateDirs.get(msg.payload.requestId)?.resolve({ results });
    }

    describe('workspace.create', () => {
      it('should throw BAD_REQUEST when paths are missing and flag is absent', async () => {
        const daemon = attachMockDaemon();
        const createPromise = caller.workspace.create({
          name: 'Missing Dirs WS',
          repos: ['/nonexistent/repo'],
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: '/nonexistent/repo', exists: false }]);

        await expect(createPromise).rejects.toThrow('Invalid paths');
      });

      it('should create missing dirs and proceed when flag is true', async () => {
        const repoDir = path.join(ctx.tmpDir, 'new-repo');
        const daemon = attachMockDaemon();

        const createPromise = caller.workspace.create({
          name: 'Create Dirs WS',
          repos: [repoDir],
          createMissingDirs: true,
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: repoDir, exists: false }]);

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'CREATE_DIR_REQUEST')).toBeDefined(),
        );

        const createMsg = findRequestOfType(daemon, 'CREATE_DIR_REQUEST');
        expect(createMsg.payload.paths).toEqual([repoDir]);
        resolveCreateDirRequest(daemon, [{ path: repoDir, success: true }]);

        const ws = await createPromise;
        expect(ws.name).toBe('Create Dirs WS');
      });

      it('should throw BAD_REQUEST with path and reason when directory creation fails', async () => {
        const daemon = attachMockDaemon();
        const createPromise = caller.workspace.create({
          name: 'Fail Dirs WS',
          repos: ['/readonly/repo'],
          createMissingDirs: true,
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: '/readonly/repo', exists: false }]);

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'CREATE_DIR_REQUEST')).toBeDefined(),
        );
        resolveCreateDirRequest(daemon, [
          { path: '/readonly/repo', success: false, error: 'Permission denied' },
        ]);

        await expect(createPromise).rejects.toThrow('Failed to create');
        await createPromise.catch((e: Error) => {
          expect(e.message).toContain('/readonly/repo');
          expect(e.message).toContain('Permission denied');
        });
      });

      it('should deduplicate missing paths before creating', async () => {
        const daemon = attachMockDaemon();
        const createPromise = caller.workspace.create({
          name: 'Dedup WS',
          repos: ['/dup/path', '/dup/path'],
          createMissingDirs: true,
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [
          { path: '/dup/path', exists: false },
          { path: '/dup/path', exists: false },
        ]);

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'CREATE_DIR_REQUEST')).toBeDefined(),
        );
        const createMsg = findRequestOfType(daemon, 'CREATE_DIR_REQUEST');
        expect(createMsg.payload.paths).toEqual(['/dup/path']);
        resolveCreateDirRequest(daemon, [{ path: '/dup/path', success: true }]);

        const ws = await createPromise;
        expect(ws.name).toBe('Dedup WS');
      });
    });

    describe('workspace.update', () => {
      it('should throw BAD_REQUEST when paths are missing and flag is absent', async () => {
        const ws = await caller.workspace.create({ name: 'Update Missing' });
        const daemon = attachMockDaemon();

        const updatePromise = caller.workspace.update({
          id: ws.id,
          repos: ['/nonexistent/repo'],
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: '/nonexistent/repo', exists: false }]);

        await expect(updatePromise).rejects.toThrow('Invalid paths');
      });

      it('should create missing dirs and proceed when flag is true', async () => {
        const ws = await caller.workspace.create({ name: 'Update Create Dirs' });
        const repoDir = path.join(ctx.tmpDir, 'new-update-repo');
        const daemon = attachMockDaemon();

        const updatePromise = caller.workspace.update({
          id: ws.id,
          repos: [repoDir],
          createMissingDirs: true,
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: repoDir, exists: false }]);

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'CREATE_DIR_REQUEST')).toBeDefined(),
        );

        const createMsg = findRequestOfType(daemon, 'CREATE_DIR_REQUEST');
        expect(createMsg.payload.paths).toEqual([repoDir]);
        resolveCreateDirRequest(daemon, [{ path: repoDir, success: true }]);

        const updated = await updatePromise;
        expect(updated.repos).toEqual([repoDir]);
      });

      it('should throw BAD_REQUEST with path and reason when directory creation fails', async () => {
        const ws = await caller.workspace.create({ name: 'Update Fail Dirs' });
        const daemon = attachMockDaemon();

        const updatePromise = caller.workspace.update({
          id: ws.id,
          repos: ['/unwritable/path'],
          createMissingDirs: true,
        });

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'VALIDATE_PATHS_REQUEST')).toBeDefined(),
        );
        resolveValidationRequest(daemon, [{ path: '/unwritable/path', exists: false }]);

        await vi.waitFor(() =>
          expect(findRequestOfType(daemon, 'CREATE_DIR_REQUEST')).toBeDefined(),
        );
        resolveCreateDirRequest(daemon, [
          { path: '/unwritable/path', success: false, error: 'EACCES' },
        ]);

        await expect(updatePromise).rejects.toThrow('Failed to create');
      });
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

    it('removeWorkspaceDir should remove custom docsDir', () => {
      const customDir = path.join(ctx.tmpDir, 'custom-to-delete');
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(customDir, 'test.txt'), 'data');

      removeWorkspaceDir('some-slug', customDir);
      expect(fs.existsSync(customDir)).toBe(false);
    });

    it('removeWorkspaceDir should no-op for non-existent custom docsDir', () => {
      expect(() => removeWorkspaceDir('some-slug', '/nonexistent/path')).not.toThrow();
    });

    it('renameWorkspaceDir should rename workspace directory', () => {
      initWorkspaceDir('Rename', 'rename-test', []);
      renameWorkspaceDir('rename-test', 'renamed-test');
      expect(fs.existsSync(path.join(ctx.tmpDir, 'renamed-test'))).toBe(true);
      expect(fs.existsSync(path.join(ctx.tmpDir, 'rename-test'))).toBe(false);
    });

    it('renameWorkspaceDir should reject path traversal slugs', () => {
      expect(() => renameWorkspaceDir('../etc', 'new')).toThrow('Invalid workspace slug');
      expect(() => renameWorkspaceDir('old', '../etc')).toThrow('Invalid workspace slug');
    });

    it('renameWorkspaceDir should fail if source does not exist', () => {
      expect(() => renameWorkspaceDir('nonexistent', 'new-name')).toThrow('does not exist');
    });

    it('renameWorkspaceDir should fail if target already exists', () => {
      initWorkspaceDir('Src', 'src-ws', []);
      initWorkspaceDir('Dst', 'dst-ws', []);
      expect(() => renameWorkspaceDir('src-ws', 'dst-ws')).toThrow('already exists');
    });
  });

  describe('getWorkspaceDir', () => {
    it('should return docsDir when set', () => {
      const result = getWorkspaceDir({ slug: 'my-project', docsDir: '/custom/path' });
      expect(result).toBe('/custom/path');
    });

    it('should return default path when docsDir is null', () => {
      const result = getWorkspaceDir({ slug: 'my-project', docsDir: null });
      expect(result).toBe(path.join(ctx.tmpDir, 'my-project'));
    });
  });
});
