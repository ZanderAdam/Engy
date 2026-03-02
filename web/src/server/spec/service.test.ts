import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { workspaces, tasks } from '../db/schema';
import {
  listSpecs,
  createSpec,
  getSpec,
  updateSpec,
  deleteSpec,
  listContextFiles,
  readContextFile,
  writeContextFile,
  deleteContextFile,
  checkSpecReadiness,
} from './service';

type Workspace = { slug: string; docsDir: string | null };

describe('spec service', () => {
  let ctx: TestContext;
  let workspace: Workspace;

  beforeEach(() => {
    ctx = setupTestDb();
    const db = getDb();
    const ws = db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
    workspace = { slug: ws.slug, docsDir: null };

    // Create specs/ directory
    fs.mkdirSync(path.join(ctx.tmpDir, 'test', 'specs'), { recursive: true });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('listSpecs', () => {
    it('should return empty array for workspace with no specs', () => {
      expect(listSpecs(workspace)).toEqual([]);
    });

    it('should list specs with correct metadata', () => {
      createSpec(workspace, 'Auth', 'buildable');
      createSpec(workspace, 'Platform Vision', 'vision');

      const specs = listSpecs(workspace);
      expect(specs).toHaveLength(2);

      const auth = specs.find((s) => s.name.includes('auth'));
      expect(auth).toBeDefined();
      expect(auth!.type).toBe('buildable');
      expect(auth!.status).toBe('draft');

      const vision = specs.find((s) => s.name === 'platform-vision');
      expect(vision).toBeDefined();
      expect(vision!.type).toBe('vision');
    });
  });

  describe('createSpec', () => {
    it('should create buildable spec with auto-numbering', () => {
      const spec = createSpec(workspace, 'Auth', 'buildable');
      expect(spec.name).toBe('1_auth');
      expect(spec.type).toBe('buildable');
      expect(spec.status).toBe('draft');

      const specDir = path.join(ctx.tmpDir, 'test', 'specs', '1_auth');
      expect(fs.existsSync(path.join(specDir, 'spec.md'))).toBe(true);
      expect(fs.existsSync(path.join(specDir, 'context'))).toBe(true);
    });

    it('should create vision spec without numbering', () => {
      const spec = createSpec(workspace, 'Platform Vision', 'vision');
      expect(spec.name).toBe('platform-vision');
      expect(spec.type).toBe('vision');
    });

    it('should auto-number based on highest existing prefix', () => {
      createSpec(workspace, 'Auth', 'buildable'); // 1_auth
      createSpec(workspace, 'Payments', 'buildable'); // 2_payments

      const specs = listSpecs(workspace);
      const names = specs.map((s) => s.name).sort();
      expect(names).toContain('1_auth');
      expect(names).toContain('2_payments');
    });

    it('should not gap-fill when prefixes have gaps', () => {
      createSpec(workspace, 'Auth', 'buildable'); // 1_auth
      // Manually create 3_xxx to create a gap at 2
      const specsPath = path.join(ctx.tmpDir, 'test', 'specs', '3_manual');
      fs.mkdirSync(path.join(specsPath, 'context'), { recursive: true });
      fs.writeFileSync(
        path.join(specsPath, 'spec.md'),
        '---\ntitle: Manual\nstatus: draft\ntype: buildable\n---\n# Manual\n',
      );

      const spec = createSpec(workspace, 'Next', 'buildable');
      expect(spec.name).toBe('4_next'); // highest (3) + 1, not gap-fill (2)
    });
  });

  describe('getSpec', () => {
    it('should return full spec content', () => {
      createSpec(workspace, 'Auth', 'buildable');
      writeContextFile(workspace, '1_auth', 'notes.md', 'Research notes');
      writeContextFile(workspace, '1_auth', 'schema.sql', 'CREATE TABLE...');

      const spec = getSpec(workspace, '1_auth');
      expect(spec.frontmatter.title).toBe('Auth');
      expect(spec.frontmatter.type).toBe('buildable');
      expect(spec.body).toContain('# Auth');
      expect(spec.files).toContain('context/notes.md');
      expect(spec.files).toContain('context/schema.sql');
    });

    it('should throw for non-existent spec', () => {
      expect(() => getSpec(workspace, 'nonexistent')).toThrow('not found');
    });

    it('should reject path traversal', () => {
      expect(() => getSpec(workspace, '../../../etc/passwd')).toThrow('Path traversal');
    });
  });

  describe('updateSpec', () => {
    it('should update spec body', () => {
      createSpec(workspace, 'Auth', 'buildable');
      updateSpec(workspace, '1_auth', { body: 'New content' });

      const spec = getSpec(workspace, '1_auth');
      expect(spec.body).toBe('New content');
      expect(spec.frontmatter.title).toBe('Auth'); // preserved
    });

    it('should update spec title', () => {
      createSpec(workspace, 'Auth', 'buildable');
      updateSpec(workspace, '1_auth', { title: 'Auth Revamp' });

      const spec = getSpec(workspace, '1_auth');
      expect(spec.frontmatter.title).toBe('Auth Revamp');
    });

    describe('buildable lifecycle', () => {
      it('should allow draft → ready when all tasks done', () => {
        createSpec(workspace, 'Auth', 'buildable');
        // No tasks = nothing blocking
        const result = updateSpec(workspace, '1_auth', { status: 'ready' });
        expect(result.status).toBe('ready');
      });

      it('should block draft → ready with incomplete tasks', () => {
        createSpec(workspace, 'Auth', 'buildable');
        const db = getDb();
        db.insert(tasks).values({
          title: 'Task 1',
          specId: '1_auth',
          status: 'todo',
        }).run();

        expect(() => updateSpec(workspace, '1_auth', { status: 'ready' })).toThrow(
          'incomplete tasks',
        );
      });

      it('should allow draft → ready when all tasks are done', () => {
        createSpec(workspace, 'Auth', 'buildable');
        const db = getDb();
        db.insert(tasks).values({
          title: 'Task 1',
          specId: '1_auth',
          status: 'done',
        }).run();

        const result = updateSpec(workspace, '1_auth', { status: 'ready' });
        expect(result.status).toBe('ready');
      });

      it('should allow ready → approved', () => {
        createSpec(workspace, 'Auth', 'buildable');
        updateSpec(workspace, '1_auth', { status: 'ready' });
        const result = updateSpec(workspace, '1_auth', { status: 'approved' });
        expect(result.status).toBe('approved');
      });

      it('should allow approved → active', () => {
        createSpec(workspace, 'Auth', 'buildable');
        updateSpec(workspace, '1_auth', { status: 'ready' });
        updateSpec(workspace, '1_auth', { status: 'approved' });
        const result = updateSpec(workspace, '1_auth', { status: 'active' });
        expect(result.status).toBe('active');
      });

      it('should allow active → completed', () => {
        createSpec(workspace, 'Auth', 'buildable');
        updateSpec(workspace, '1_auth', { status: 'ready' });
        updateSpec(workspace, '1_auth', { status: 'approved' });
        updateSpec(workspace, '1_auth', { status: 'active' });
        const result = updateSpec(workspace, '1_auth', { status: 'completed' });
        expect(result.status).toBe('completed');
      });

      it('should reject invalid transition (draft → approved)', () => {
        createSpec(workspace, 'Auth', 'buildable');
        expect(() => updateSpec(workspace, '1_auth', { status: 'approved' })).toThrow(
          'Invalid status transition',
        );
      });
    });

    describe('vision lifecycle', () => {
      it('should allow draft → completed', () => {
        createSpec(workspace, 'Vision', 'vision');
        const result = updateSpec(workspace, 'vision', { status: 'completed' });
        expect(result.status).toBe('completed');
      });

      it('should reject draft → ready for vision specs', () => {
        createSpec(workspace, 'Vision', 'vision');
        expect(() => updateSpec(workspace, 'vision', { status: 'ready' })).toThrow(
          'Invalid status transition',
        );
      });
    });
  });

  describe('deleteSpec', () => {
    it('should remove spec directory from disk', () => {
      createSpec(workspace, 'Auth', 'buildable');
      const specDir = path.join(ctx.tmpDir, 'test', 'specs', '1_auth');
      expect(fs.existsSync(specDir)).toBe(true);

      deleteSpec(workspace, '1_auth');
      expect(fs.existsSync(specDir)).toBe(false);
    });

    it('should cascade-delete tasks with matching specId', () => {
      createSpec(workspace, 'Auth', 'buildable');
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: '1_auth', status: 'todo' }).run();
      db.insert(tasks).values({ title: 'T2', specId: '1_auth', status: 'done' }).run();
      db.insert(tasks).values({ title: 'T3', specId: 'other', status: 'todo' }).run();

      deleteSpec(workspace, '1_auth');

      const remaining = db.select().from(tasks).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].specId).toBe('other');
    });

    it('should delete spec with no associated tasks', () => {
      createSpec(workspace, 'Auth', 'buildable');
      expect(() => deleteSpec(workspace, '1_auth')).not.toThrow();
    });

    it('should throw for non-existent spec', () => {
      expect(() => deleteSpec(workspace, 'nonexistent')).toThrow('not found');
    });

    it('should reject path traversal', () => {
      expect(() => deleteSpec(workspace, '../../../etc')).toThrow('Path traversal');
    });
  });

  describe('context files', () => {
    beforeEach(() => {
      createSpec(workspace, 'Auth', 'buildable');
    });

    it('should list context files sorted', () => {
      writeContextFile(workspace, '1_auth', 'notes.md', 'data');
      writeContextFile(workspace, '1_auth', 'diagram.png', 'data');

      const files = listContextFiles(workspace, '1_auth');
      expect(files).toEqual(['diagram.png', 'notes.md']);
    });

    it('should read context file', () => {
      writeContextFile(workspace, '1_auth', 'notes.md', 'Research notes');
      const content = readContextFile(workspace, '1_auth', 'notes.md');
      expect(content).toBe('Research notes');
    });

    it('should write new context file', () => {
      writeContextFile(workspace, '1_auth', 'new.md', 'Content');
      const content = readContextFile(workspace, '1_auth', 'new.md');
      expect(content).toBe('Content');
    });

    it('should overwrite existing context file', () => {
      writeContextFile(workspace, '1_auth', 'notes.md', 'Old');
      writeContextFile(workspace, '1_auth', 'notes.md', 'New');
      expect(readContextFile(workspace, '1_auth', 'notes.md')).toBe('New');
    });

    it('should delete context file', () => {
      writeContextFile(workspace, '1_auth', 'notes.md', 'data');
      deleteContextFile(workspace, '1_auth', 'notes.md');
      expect(listContextFiles(workspace, '1_auth')).toEqual([]);
    });

    it('should throw when reading non-existent context file', () => {
      expect(() => readContextFile(workspace, '1_auth', 'missing.md')).toThrow('not found');
    });

    it('should reject path traversal in context file operations', () => {
      expect(() => writeContextFile(workspace, '1_auth', '../../outside.txt', 'data')).toThrow(
        'Path traversal',
      );
      expect(() => readContextFile(workspace, '1_auth', '../../etc/passwd')).toThrow(
        'Path traversal',
      );
      expect(() => deleteContextFile(workspace, '1_auth', '../../etc/passwd')).toThrow(
        'Path traversal',
      );
    });
  });

  describe('checkSpecReadiness', () => {
    it('should return true when all tasks are done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'test-spec', status: 'done' }).run();
      db.insert(tasks).values({ title: 'T2', specId: 'test-spec', status: 'done' }).run();
      expect(checkSpecReadiness('test-spec')).toBe(true);
    });

    it('should return false when some tasks are not done', () => {
      const db = getDb();
      db.insert(tasks).values({ title: 'T1', specId: 'test-spec', status: 'done' }).run();
      db.insert(tasks).values({ title: 'T2', specId: 'test-spec', status: 'todo' }).run();
      expect(checkSpecReadiness('test-spec')).toBe(false);
    });

    it('should return true when no tasks exist', () => {
      expect(checkSpecReadiness('no-tasks')).toBe(true);
    });
  });
});
