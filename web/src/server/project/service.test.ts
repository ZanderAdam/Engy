import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { workspaces, projects, tasks } from '../db/schema';
import {
  listProjectFiles,
  readProjectImage,
  initProjectDir,
  removeProjectDir,
  getProjectSpec,
  updateProjectSpec,
  listProjectContextFiles,
  readProjectContextFile,
  writeProjectContextFile,
  deleteProjectContextFile,
  checkProjectReadiness,
  writeProjectFile,
  deleteProjectFile,
  renameProjectFile,
  deleteProjectSubDir,
} from './service';

type Workspace = { slug: string; docsDir: string | null };

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

    it('should not overwrite an existing spec.md', () => {
      const projDir = path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature');
      fs.mkdirSync(projDir, { recursive: true });
      const existingContent = '---\ntitle: hand-authored\nstatus: active\ntype: vision\n---\n# Hand-authored\n';
      fs.writeFileSync(path.join(projDir, 'spec.md'), existingContent);

      initProjectDir(workspace, 'auth-feature');

      const actual = fs.readFileSync(path.join(projDir, 'spec.md'), 'utf-8');
      expect(actual).toBe(existingContent);
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

    it('should include image files alongside markdown', () => {
      initProjectDir(workspace, 'auth-feature');
      const projDir = path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature');
      fs.writeFileSync(path.join(projDir, 'diagram.png'), Buffer.from(PNG_1X1_BASE64, 'base64'));
      const result = listProjectFiles(workspace, 'auth-feature');
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('diagram.png');
      expect(paths).toContain('spec.md');
    });
  });

  describe('readProjectImage', () => {
    beforeEach(() => {
      initProjectDir(workspace, 'auth-feature');
      const projDir = path.join(ctx.tmpDir, 'test', 'projects', 'auth-feature');
      fs.writeFileSync(path.join(projDir, 'diagram.png'), Buffer.from(PNG_1X1_BASE64, 'base64'));
    });

    it('should return a base64 data URI for an image', () => {
      const dataUri = readProjectImage(workspace, 'auth-feature', 'diagram.png');
      expect(dataUri).toBe(`data:image/png;base64,${PNG_1X1_BASE64}`);
    });

    it('should reject non-image files', () => {
      expect(() => readProjectImage(workspace, 'auth-feature', 'spec.md')).toThrow(
        'Not a supported image',
      );
    });

    it('should throw for a missing image', () => {
      expect(() => readProjectImage(workspace, 'auth-feature', 'missing.png')).toThrow('not found');
    });

    it('should reject path traversal', () => {
      expect(() => readProjectImage(workspace, 'auth-feature', '../../secret.png')).toThrow(
        'Path traversal',
      );
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
    let projectId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.select().from(workspaces).all()[0];
      const proj = db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'auth-feature', slug: 'auth-feature', projectDir: 'auth-feature' })
        .returning()
        .get();
      projectId = proj.id;
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
      expect(() => updateProjectSpec(workspace, 'auth-feature', { status: 'approved' })).toThrow(
        'Invalid status transition',
      );
    });

    it('should block draft → ready with incomplete tasks', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId, status: 'todo' }).run();
      expect(() => updateProjectSpec(workspace, 'auth-feature', { status: 'ready' })).toThrow(
        'incomplete tasks',
      );
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
      expect(() => readProjectContextFile(workspace, 'auth-feature', 'missing.md')).toThrow(
        'not found',
      );
    });

    it('should reject path traversal in context file operations', () => {
      expect(() =>
        writeProjectContextFile(workspace, 'auth-feature', '../../outside.txt', 'data'),
      ).toThrow('Path traversal');
    });
  });

  describe('spec.md path guard (normalized)', () => {
    beforeEach(() => {
      initProjectDir(workspace, 'auth-feature');
    });

    it('should reject ./spec.md in writeProjectFile', () => {
      expect(() =>
        writeProjectFile(workspace, 'auth-feature', './spec.md', 'overwrite'),
      ).toThrow('updateProjectSpec');
    });

    it('should reject docs/../spec.md in writeProjectFile', () => {
      expect(() =>
        writeProjectFile(workspace, 'auth-feature', 'docs/../spec.md', 'overwrite'),
      ).toThrow('updateProjectSpec');
    });

    it('should reject ./spec.md in deleteProjectFile', () => {
      expect(() =>
        deleteProjectFile(workspace, 'auth-feature', './spec.md'),
      ).toThrow('Cannot delete spec.md');
    });

    it('should reject docs/../spec.md in deleteProjectFile', () => {
      expect(() =>
        deleteProjectFile(workspace, 'auth-feature', 'docs/../spec.md'),
      ).toThrow('Cannot delete spec.md');
    });

    it('should reject renaming ./spec.md', () => {
      expect(() =>
        renameProjectFile(workspace, 'auth-feature', './spec.md', 'new-name.md'),
      ).toThrow('Cannot rename spec.md');
    });

    it('should reject "." as deleteDir target (project root)', () => {
      expect(() =>
        deleteProjectSubDir(workspace, 'auth-feature', '.'),
      ).toThrow('project root');
    });
  });

  describe('checkProjectReadiness', () => {
    let projectId: number;

    beforeEach(() => {
      const db = getDb();
      const ws = db.select().from(workspaces).all()[0];
      const proj = db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'test-proj', slug: 'test-proj', projectDir: 'test-proj' })
        .returning()
        .get();
      projectId = proj.id;
    });

    it('should return true when all tasks are done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId, status: 'done' }).run();
      expect(checkProjectReadiness(projectId)).toBe(true);
    });

    it('should return false when some tasks are not done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', projectId, status: 'todo' }).run();
      expect(checkProjectReadiness(projectId)).toBe(false);
    });

    it('should return true when no tasks exist', () => {
      expect(checkProjectReadiness(projectId)).toBe(true);
    });

    it('should ignore tasks from a different project', () => {
      const db = getDb();
      const ws = db.select().from(workspaces).all()[0];
      const otherProj = db
        .insert(projects)
        .values({
          workspaceId: ws.id,
          name: 'other-proj',
          slug: 'other-proj',
          projectDir: 'other-proj',
        })
        .returning()
        .get();
      db.insert(tasks).values({ title: 'T-other', projectId: otherProj.id, status: 'todo' }).run();
      expect(checkProjectReadiness(projectId)).toBe(true);
    });
  });
});
