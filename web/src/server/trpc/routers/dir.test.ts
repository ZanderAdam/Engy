import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('dir router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let testDir: string;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-dir-test-'));
    // Create test structure:
    // testDir/
    //   readme.md
    //   notes.md
    //   sub/
    //     sub-note.md
    //   empty-sub/        (no .md files)
    //   deep/
    //     nested/
    //       deep.md
    fs.writeFileSync(path.join(testDir, 'readme.md'), '# Readme\nHello world');
    fs.writeFileSync(path.join(testDir, 'notes.md'), '# Notes\nSome notes');
    fs.mkdirSync(path.join(testDir, 'sub'));
    fs.writeFileSync(path.join(testDir, 'sub', 'sub-note.md'), '# Sub note');
    fs.mkdirSync(path.join(testDir, 'empty-sub'));
    fs.writeFileSync(path.join(testDir, 'empty-sub', 'not-markdown.txt'), 'text file');
    fs.mkdirSync(path.join(testDir, 'deep', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'deep', 'nested', 'deep.md'), '# Deep');
  });

  afterEach(() => {
    ctx.cleanup();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('home', () => {
    it('should return the OS home directory', async () => {
      const result = await caller.dir.home();
      expect(result.path).toBe(os.homedir());
    });
  });

  describe('listDirs', () => {
    it('should return all non-hidden subdirectories', async () => {
      const result = await caller.dir.listDirs({ dirPath: testDir });
      expect(result.dirs).toContain('sub');
      expect(result.dirs).toContain('deep');
      expect(result.dirs).toContain('empty-sub'); // unlike list, empty-sub has no md but is still a dir
    });

    it('should exclude dotfiles', async () => {
      fs.mkdirSync(path.join(testDir, '.hidden'));
      const result = await caller.dir.listDirs({ dirPath: testDir });
      expect(result.dirs).not.toContain('.hidden');
    });

    it('should return sorted results', async () => {
      const result = await caller.dir.listDirs({ dirPath: testDir });
      expect(result.dirs).toEqual([...result.dirs].sort());
    });

    it('should return empty dirs for non-existent path', async () => {
      const result = await caller.dir.listDirs({ dirPath: path.join(testDir, 'does-not-exist') });
      expect(result.dirs).toEqual([]);
    });

    it('should return empty dirs for a file path', async () => {
      const result = await caller.dir.listDirs({ dirPath: path.join(testDir, 'readme.md') });
      expect(result.dirs).toEqual([]);
    });
  });

  describe('list', () => {
    it('should return md files and subdirs containing md files', async () => {
      const result = await caller.dir.list({ dirPath: testDir });

      expect(result.files).toEqual(['notes.md', 'readme.md']);
      expect(result.dirs).toContain('sub');
      expect(result.dirs).toContain('deep');
      expect(result.dirs).not.toContain('empty-sub');
    });

    it('should throw NOT_FOUND for non-existent directory', async () => {
      await expect(
        caller.dir.list({ dirPath: path.join(testDir, 'does-not-exist') }),
      ).rejects.toThrow('not found');
    });

    it('should throw BAD_REQUEST for a file path', async () => {
      await expect(
        caller.dir.list({ dirPath: path.join(testDir, 'readme.md') }),
      ).rejects.toThrow();
    });

    it('should return sorted results', async () => {
      const result = await caller.dir.list({ dirPath: testDir });
      expect(result.files).toEqual([...result.files].sort());
      expect(result.dirs).toEqual([...result.dirs].sort());
    });
  });

  describe('read', () => {
    it('should return file content', async () => {
      const result = await caller.dir.read({ dirPath: testDir, filePath: 'readme.md' });
      expect(result.content).toBe('# Readme\nHello world');
    });

    it('should read files in subdirectories', async () => {
      const result = await caller.dir.read({ dirPath: testDir, filePath: 'sub/sub-note.md' });
      expect(result.content).toBe('# Sub note');
    });

    it('should throw NOT_FOUND for missing file', async () => {
      await expect(
        caller.dir.read({ dirPath: testDir, filePath: 'missing.md' }),
      ).rejects.toThrow('not found');
    });

    it('should reject path traversal', async () => {
      await expect(
        caller.dir.read({ dirPath: testDir, filePath: '../../etc/secret.md' }),
      ).rejects.toThrow('traversal');
    });

    it('should reject absolute file paths', async () => {
      await expect(
        caller.dir.read({ dirPath: testDir, filePath: '/etc/secret.md' }),
      ).rejects.toThrow('Absolute paths not allowed');
    });

    it('should reject non-md files', async () => {
      await expect(
        caller.dir.read({ dirPath: testDir, filePath: 'notes.txt' }),
      ).rejects.toThrow();
    });
  });

  describe('write', () => {
    it('should write content to an existing file', async () => {
      await caller.dir.write({ dirPath: testDir, filePath: 'readme.md', content: '# Updated' });
      expect(fs.readFileSync(path.join(testDir, 'readme.md'), 'utf-8')).toBe('# Updated');
    });

    it('should create a new file', async () => {
      await caller.dir.write({ dirPath: testDir, filePath: 'new-file.md', content: '# New' });
      expect(fs.readFileSync(path.join(testDir, 'new-file.md'), 'utf-8')).toBe('# New');
    });

    it('should create parent directories as needed', async () => {
      await caller.dir.write({ dirPath: testDir, filePath: 'new-dir/file.md', content: '# Nested' });
      expect(fs.readFileSync(path.join(testDir, 'new-dir', 'file.md'), 'utf-8')).toBe('# Nested');
    });

    it('should reject path traversal', async () => {
      await expect(
        caller.dir.write({ dirPath: testDir, filePath: '../evil.md', content: 'bad' }),
      ).rejects.toThrow('traversal');
    });

    it('should reject absolute file paths', async () => {
      await expect(
        caller.dir.write({ dirPath: testDir, filePath: '/tmp/evil.md', content: 'bad' }),
      ).rejects.toThrow('Absolute paths not allowed');
    });

    it('should reject non-md files', async () => {
      await expect(
        caller.dir.write({ dirPath: testDir, filePath: 'evil.sh', content: 'bad' }),
      ).rejects.toThrow();
    });

    it('should round-trip read/write correctly', async () => {
      const content = '# Round trip\n\nSome content with **bold** and _italic_.';
      await caller.dir.write({ dirPath: testDir, filePath: 'round-trip.md', content });
      const result = await caller.dir.read({ dirPath: testDir, filePath: 'round-trip.md' });
      expect(result.content).toBe(content);
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing md file', async () => {
      expect(fs.existsSync(path.join(testDir, 'readme.md'))).toBe(true);
      const result = await caller.dir.deleteFile({ dirPath: testDir, filePath: 'readme.md' });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'readme.md'))).toBe(false);
    });

    it('should delete a file in a subdirectory', async () => {
      const result = await caller.dir.deleteFile({ dirPath: testDir, filePath: 'sub/sub-note.md' });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'sub', 'sub-note.md'))).toBe(false);
    });

    it('should throw NOT_FOUND for missing file', async () => {
      await expect(
        caller.dir.deleteFile({ dirPath: testDir, filePath: 'missing.md' }),
      ).rejects.toThrow('not found');
    });

    it('should reject non-md files', async () => {
      await expect(
        caller.dir.deleteFile({ dirPath: testDir, filePath: 'evil.sh' }),
      ).rejects.toThrow('Only .md files');
    });

    it('should reject path traversal', async () => {
      await expect(
        caller.dir.deleteFile({ dirPath: testDir, filePath: '../../etc/secret.md' }),
      ).rejects.toThrow('traversal');
    });
  });

  describe('deleteDir', () => {
    it('should delete an existing directory recursively', async () => {
      expect(fs.existsSync(path.join(testDir, 'deep', 'nested', 'deep.md'))).toBe(true);
      const result = await caller.dir.deleteDir({ dirPath: testDir, subDir: 'deep' });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'deep'))).toBe(false);
    });

    it('should delete an empty directory', async () => {
      const emptyDir = path.join(testDir, 'brand-new');
      fs.mkdirSync(emptyDir);
      const result = await caller.dir.deleteDir({ dirPath: testDir, subDir: 'brand-new' });
      expect(result.success).toBe(true);
      expect(fs.existsSync(emptyDir)).toBe(false);
    });

    it('should throw NOT_FOUND for missing directory', async () => {
      await expect(
        caller.dir.deleteDir({ dirPath: testDir, subDir: 'does-not-exist' }),
      ).rejects.toThrow('not found');
    });

    it('should reject path traversal', async () => {
      await expect(
        caller.dir.deleteDir({ dirPath: testDir, subDir: '../../tmp' }),
      ).rejects.toThrow('traversal');
    });
  });

  describe('renameFile', () => {
    it('should rename a file', async () => {
      const result = await caller.dir.renameFile({
        dirPath: testDir, oldPath: 'readme.md', newPath: 'renamed.md',
      });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'readme.md'))).toBe(false);
      expect(fs.existsSync(path.join(testDir, 'renamed.md'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'renamed.md'), 'utf-8')).toBe('# Readme\nHello world');
    });

    it('should rename a file in a subdirectory', async () => {
      const result = await caller.dir.renameFile({
        dirPath: testDir, oldPath: 'sub/sub-note.md', newPath: 'sub/renamed-note.md',
      });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'sub', 'sub-note.md'))).toBe(false);
      expect(fs.existsSync(path.join(testDir, 'sub', 'renamed-note.md'))).toBe(true);
    });

    it('should throw CONFLICT if target already exists', async () => {
      await expect(
        caller.dir.renameFile({ dirPath: testDir, oldPath: 'readme.md', newPath: 'notes.md' }),
      ).rejects.toThrow('already exists');
    });

    it('should throw NOT_FOUND for missing source', async () => {
      await expect(
        caller.dir.renameFile({ dirPath: testDir, oldPath: 'missing.md', newPath: 'new.md' }),
      ).rejects.toThrow('not found');
    });

    it('should reject non-md files', async () => {
      await expect(
        caller.dir.renameFile({ dirPath: testDir, oldPath: 'readme.txt', newPath: 'new.txt' }),
      ).rejects.toThrow('Only .md files');
    });

    it('should reject path traversal on source', async () => {
      await expect(
        caller.dir.renameFile({ dirPath: testDir, oldPath: '../../etc/secret.md', newPath: 'new.md' }),
      ).rejects.toThrow('traversal');
    });

    it('should reject path traversal on destination', async () => {
      await expect(
        caller.dir.renameFile({ dirPath: testDir, oldPath: 'readme.md', newPath: '../../escape.md' }),
      ).rejects.toThrow('traversal');
    });
  });

  describe('renameDir', () => {
    it('should rename a directory', async () => {
      const result = await caller.dir.renameDir({
        dirPath: testDir, oldSubDir: 'sub', newSubDir: 'renamed-sub',
      });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'sub'))).toBe(false);
      expect(fs.existsSync(path.join(testDir, 'renamed-sub'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'renamed-sub', 'sub-note.md'))).toBe(true);
    });

    it('should throw CONFLICT if target already exists', async () => {
      await expect(
        caller.dir.renameDir({ dirPath: testDir, oldSubDir: 'sub', newSubDir: 'deep' }),
      ).rejects.toThrow('already exists');
    });

    it('should throw NOT_FOUND for missing source', async () => {
      await expect(
        caller.dir.renameDir({ dirPath: testDir, oldSubDir: 'nonexistent', newSubDir: 'new-dir' }),
      ).rejects.toThrow('not found');
    });

    it('should reject path traversal on source', async () => {
      await expect(
        caller.dir.renameDir({ dirPath: testDir, oldSubDir: '../../tmp', newSubDir: 'new' }),
      ).rejects.toThrow('traversal');
    });

    it('should reject path traversal on destination', async () => {
      await expect(
        caller.dir.renameDir({ dirPath: testDir, oldSubDir: 'sub', newSubDir: '../../escape' }),
      ).rejects.toThrow('traversal');
    });
  });
});
