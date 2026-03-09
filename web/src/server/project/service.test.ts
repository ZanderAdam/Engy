import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { workspaces, tasks } from '../db/schema';
import {
  listProjectFiles,
  initProjectDir,
  removeProjectDir,
  getProjectSpec,
  updateProjectSpec,
  listProjectContextFiles,
  readProjectContextFile,
  writeProjectContextFile,
  deleteProjectContextFile,
  checkProjectReadiness,
} from './service';

type Workspace = { slug: string; docsDir: string | null };

describe('project service', () => {
  let ctx: TestContext;
  let workspace: Workspace;

  beforeEach(() => {
    ctx = setupTestDb();
    const db = getDb();
    const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
    workspace = { slug: ws.slug, docsDir: null };

    // Create projects/ directory
    fs.mkdirSync(path.join(ctx.tmpDir, 'test', 'projects'), { recursive: true });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('initProjectDir', () => {
    it('should create project directory with spec.md', () => {
      initProjectDir(workspace, 'auth-feature');
      const projDir = path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature');
      expect(fs.existsSync(path.join(projDir, 'spec.md'))).toBe(true);
    });

    it('should create projects/ parent directory if absent', () => {
      fs.rmdirSync(path.join(ctx.tmpDir, 'test', 'projects'));
      initProjectDir(workspace, 'auth-feature');
      expect(
        fs.existsSync(path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature', 'spec.md')),
      ).toBe(true);
    });
  });

  describe('listProjectFiles', () => {
    it('should return empty files for non-existent project dir', () => {
      const result = listProjectFiles(workspace, 'nonexistent');
      expect(result.files).toEqual([]);
      expect(result.name).toBe('nonexistent');
    });

    it('should list files with correct metadata after init', () => {
      initProjectDir(workspace, 'auth-feature');
      const result = listProjectFiles(workspace, 'auth-feature');
      expect(result.files).toContainEqual(
        expect.objectContaining({ path: 'spec.md', mtime: expect.any(Number) }),
      );
      expect(result.name).toBe('auth-feature');
    });

    it('should reject path traversal', () => {
      expect(() => listProjectFiles(workspace, '../../../etc')).toThrow('Path traversal');
    });
  });

  describe('getProjectSpec', () => {
    it('should return spec content', () => {
      initProjectDir(workspace, 'auth-feature');
      const spec = getProjectSpec(workspace, 'auth-feature');
      expect(spec.frontmatter.type).toBe('buildable');
      expect(spec.frontmatter.status).toBe('draft');
      expect(spec.body).toContain('# auth-feature');
    });

    it('should throw for non-existent project', () => {
      expect(() => getProjectSpec(workspace, 'nonexistent')).toThrow('not found');
    });

    it('should reject path traversal', () => {
      expect(() => getProjectSpec(workspace, '../../../etc/passwd')).toThrow('Path traversal');
    });
  });

  describe('updateProjectSpec', () => {
    beforeEach(() => {
      initProjectDir(workspace, 'auth-feature');
    });

    it('should update body', () => {
      updateProjectSpec(workspace, 'auth-feature', { body: 'New content' });
      const spec = getProjectSpec(workspace, 'auth-feature');
      expect(spec.body).toBe('New content');
    });

    it('should update title', () => {
      updateProjectSpec(workspace, 'auth-feature', { title: 'Auth Feature Updated' });
      const spec = getProjectSpec(workspace, 'auth-feature');
      expect(spec.frontmatter.title).toBe('Auth Feature Updated');
    });

    it('should allow valid status transition draft → ready', () => {
      const result = updateProjectSpec(workspace, 'auth-feature', { status: 'ready' });
      expect(result.status).toBe('ready');
    });

    it('should reject invalid status transition draft → approved', () => {
      expect(() =>
        updateProjectSpec(workspace, 'auth-feature', { status: 'approved' }),
      ).toThrow('Invalid status transition');
    });

    it('should block draft → ready with incomplete tasks', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'auth-feature', status: 'todo' }).run();
      expect(() =>
        updateProjectSpec(workspace, 'auth-feature', { status: 'ready' }),
      ).toThrow('incomplete tasks');
    });
  });

  describe('removeProjectDir', () => {
    it('should remove the project directory', () => {
      initProjectDir(workspace, 'auth-feature');
      const projDir = path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature');
      expect(fs.existsSync(projDir)).toBe(true);

      removeProjectDir(workspace, 'auth-feature');
      expect(fs.existsSync(projDir)).toBe(false);
    });

    it('should not throw if directory does not exist', () => {
      expect(() => removeProjectDir(workspace, 'nonexistent')).not.toThrow();
    });
  });

  describe('context files', () => {
    beforeEach(() => {
      initProjectDir(workspace, 'auth-feature');
    });

    it('should write and read context files', () => {
      writeProjectContextFile(workspace, 'auth-feature', 'notes.md', 'Research notes');
      const content = readProjectContextFile(workspace, 'auth-feature', 'notes.md');
      expect(content).toBe('Research notes');
    });

    it('should list context files sorted', () => {
      writeProjectContextFile(workspace, 'auth-feature', 'notes.md', 'data');
      writeProjectContextFile(workspace, 'auth-feature', 'api.yaml', 'data');
      const files = listProjectContextFiles(workspace, 'auth-feature');
      expect(files).toEqual(['api.yaml', 'notes.md']);
    });

    it('should delete context file', () => {
      writeProjectContextFile(workspace, 'auth-feature', 'notes.md', 'data');
      deleteProjectContextFile(workspace, 'auth-feature', 'notes.md');
      expect(listProjectContextFiles(workspace, 'auth-feature')).toEqual([]);
    });

    it('should throw when reading non-existent context file', () => {
      expect(() =>
        readProjectContextFile(workspace, 'auth-feature', 'missing.md'),
      ).toThrow('not found');
    });

    it('should reject path traversal in context file operations', () => {
      expect(() =>
        writeProjectContextFile(workspace, 'auth-feature', '../../outside.txt', 'data'),
      ).toThrow('Path traversal');
    });
  });

  describe('checkProjectReadiness', () => {
    it('should return true when all tasks are done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'test-proj', status: 'done' }).run();
      expect(checkProjectReadiness('test-proj')).toBe(true);
    });

    it('should return false when some tasks are not done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'test-proj', status: 'todo' }).run();
      expect(checkProjectReadiness('test-proj')).toBe(false);
    });

    it('should return true when no tasks exist', () => {
      expect(checkProjectReadiness('no-tasks')).toBe(true);
    });
  });
});
