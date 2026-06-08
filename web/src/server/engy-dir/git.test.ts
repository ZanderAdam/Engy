import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { isInsideGitRepo, ensureGitRepo } from './git';

describe('git helpers', () => {
  let tmpDir: string;
  const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  });

  afterAll(() => {
    if (originalGitConfigGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
    }
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-git-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isInsideGitRepo', () => {
    it('should return false for a plain directory', () => {
      expect(isInsideGitRepo(tmpDir)).toBe(false);
    });

    it('should return true for a git-initialized directory', async () => {
      await simpleGit(tmpDir).init();
      expect(isInsideGitRepo(tmpDir)).toBe(true);
    });

    it('should return true for a subdirectory inside a git repo', async () => {
      await simpleGit(tmpDir).init();
      const subDir = path.join(tmpDir, 'child');
      fs.mkdirSync(subDir);
      expect(isInsideGitRepo(subDir)).toBe(true);
    });
  });

  describe('ensureGitRepo', () => {
    it('should initialize a new git repo and create initial commit', async () => {
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
      const result = await ensureGitRepo(tmpDir);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(true);

      const log = await simpleGit(tmpDir).log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toBe('Initial workspace structure');
    });

    it('should be idempotent — skip if already a git repo', async () => {
      await simpleGit(tmpDir).init();
      const result = await ensureGitRepo(tmpDir);
      expect(result).toBe(false);
    });

    it('should init a fresh repo even when nested inside a parent git tree', async () => {
      await simpleGit(tmpDir).init();
      const childDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(childDir);
      fs.writeFileSync(path.join(childDir, 'test.txt'), 'hello');

      const result = await ensureGitRepo(childDir);
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(childDir, '.git'))).toBe(true);

      const log = await simpleGit(childDir).log();
      expect(log.total).toBe(1);
    });

    it('should add and commit even when parent .gitignore would exclude the workspace path', async () => {
      await simpleGit(tmpDir).init();
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'workspace/\n');
      const childDir = path.join(tmpDir, 'workspace');
      fs.mkdirSync(childDir);
      fs.writeFileSync(path.join(childDir, 'memory.md'), '---\ntitle: test\n---\n');

      const result = await ensureGitRepo(childDir);
      expect(result).toBe(true);

      const log = await simpleGit(childDir).log();
      expect(log.total).toBe(1);
      const status = await simpleGit(childDir).status();
      expect(status.files).toHaveLength(0);
    });

    it('should return false if directory does not exist', async () => {
      const result = await ensureGitRepo(path.join(tmpDir, 'nonexistent'));
      expect(result).toBe(false);
    });
  });
});
