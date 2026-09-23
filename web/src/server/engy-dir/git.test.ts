import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
    // The walk climbs to the filesystem root, so whatever sits above the temp
    // directory decides the cases that hinge on a missing `.git` — a stray
    // `/tmp/.git` made every temp dir look like a repo. Those cases declare
    // the tree instead; the one that needs a real repo still uses the disk.
    function declareGitDirs(...gitDirs: string[]): void {
      const present = new Set(gitDirs);
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => present.has(String(p)));
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return false when no directory up to the root holds a .git', () => {
      declareGitDirs();
      expect(isInsideGitRepo('/a/b/c')).toBe(false);
    });

    it('should return true for a directory that holds a .git', () => {
      declareGitDirs('/a/b/c/.git');
      expect(isInsideGitRepo('/a/b/c')).toBe(true);
    });

    it('should return true for a subdirectory below the one holding a .git', () => {
      declareGitDirs('/a/.git');
      expect(isInsideGitRepo('/a/b/c')).toBe(true);
    });

    it('should return true for a real repo on disk', async () => {
      await simpleGit(tmpDir).init();
      expect(isInsideGitRepo(tmpDir)).toBe(true);
    });
  });

  describe('ensureGitRepo', () => {
    it('[FR-WORKSPACE-050] should initialize a new git repo and create initial commit', async () => {
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
      const result = await ensureGitRepo(tmpDir);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(true);

      const log = await simpleGit(tmpDir).log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toBe('memory(init): initial workspace structure');
    });

    it('[FR-WORKSPACE-050] should be idempotent — skip if already a git repo', async () => {
      await simpleGit(tmpDir).init();
      const result = await ensureGitRepo(tmpDir);
      expect(result).toBe(false);
    });

    it('[FR-WORKSPACE-050] should init a fresh repo even when nested inside a parent git tree', async () => {
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

    it('[FR-WORKSPACE-050] should add and commit even when parent .gitignore would exclude the workspace path', async () => {
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
