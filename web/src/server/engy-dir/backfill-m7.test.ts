import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';
import { backfillM7, needsM7Backfill } from './backfill-m7';

const MEMORY_SUBTYPES = ['decisions', 'patterns', 'facts', 'conventions', 'insights'];
const INGESTION_DIRS = ['sources', 'references'];

async function setupPreM7Workspace(workspaceDir: string): Promise<void> {
  // Simulate a pre-M7 workspace: has memory/ but no READMEs and no subtypes
  fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'system'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'docs'), { recursive: true });

  const git = simpleGit(workspaceDir);
  await git.init();
  await git.addConfig('user.name', 'Test');
  await git.addConfig('user.email', 'test@localhost');
  fs.writeFileSync(path.join(workspaceDir, '.gitkeep'), '');
  await git.add('.');
  await git.commit('pre-M7 init');
}

async function setupNoMemoryWorkspace(workspaceDir: string): Promise<void> {
  // Simulate a workspace with no memory/ dir at all (the false-negative case)
  fs.mkdirSync(path.join(workspaceDir, 'system'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'docs'), { recursive: true });

  const git = simpleGit(workspaceDir);
  await git.init();
  await git.addConfig('user.name', 'Test');
  await git.addConfig('user.email', 'test@localhost');
  fs.writeFileSync(path.join(workspaceDir, '.gitkeep'), '');
  await git.add('.');
  await git.commit('no-memory init');
}

describe('backfill-m7', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('.gitignore newline guard', () => {
    it('[FR-WORKSPACE-120] should append .qmd/ on a new line when existing content has no trailing newline', async () => {
      const wsDir = path.join(ctx.tmpDir, 'gitignore-no-newline-test');
      await setupPreM7Workspace(wsDir);
      // Write .gitignore without a trailing newline.
      fs.writeFileSync(path.join(wsDir, '.gitignore'), 'node_modules', 'utf8');

      ctx.db
        .insert(workspaces)
        .values({ name: 'Gitignore No Newline', slug: 'gitignore-no-newline-test', docsDir: wsDir })
        .run();

      await backfillM7('gitignore-no-newline-test');

      const content = fs.readFileSync(path.join(wsDir, '.gitignore'), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines).toContain('node_modules');
      expect(lines).toContain('.qmd/');
      // The last rule must not be corrupted (node_modules.qmd/ would be the corruption).
      expect(lines.every((l) => !l.includes('node_modules.qmd'))).toBe(true);
    });

    it('[FR-WORKSPACE-120] should append .qmd/ without extra blank line when existing content already has trailing newline', async () => {
      const wsDir = path.join(ctx.tmpDir, 'gitignore-with-newline-test');
      await setupPreM7Workspace(wsDir);
      fs.writeFileSync(path.join(wsDir, '.gitignore'), 'node_modules\n', 'utf8');

      ctx.db
        .insert(workspaces)
        .values({ name: 'Gitignore With Newline', slug: 'gitignore-with-newline-test', docsDir: wsDir })
        .run();

      await backfillM7('gitignore-with-newline-test');

      const content = fs.readFileSync(path.join(wsDir, '.gitignore'), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines).toEqual(['node_modules', '.qmd/']);
    });
  });

  describe('needsM7Backfill', () => {
    it('should return true when memory/ exists but memory/README.md does not', () => {
      const dir = path.join(ctx.tmpDir, 'test-ws');
      fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
      expect(needsM7Backfill(dir)).toBe(true);
    });

    it('should return false when memory/README.md exists', () => {
      const dir = path.join(ctx.tmpDir, 'test-ws');
      fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'memory', 'README.md'), '# Memory\n');
      expect(needsM7Backfill(dir)).toBe(false);
    });

    it('should return true when memory/ does not exist at all', () => {
      // Regression: pre-M7 workspaces with no memory/ dir at all were previously
      // returning false and never getting backfilled.
      const dir = path.join(ctx.tmpDir, 'no-memory-ws');
      fs.mkdirSync(dir, { recursive: true });
      expect(needsM7Backfill(dir)).toBe(true);
    });
  });

  describe('backfillM7', () => {
    it('should throw for unknown workspace slug', async () => {
      await expect(backfillM7('nonexistent-slug')).rejects.toThrow('Workspace not found');
    });

    it('[FR-WORKSPACE-120] should create all M7 subdirectory structure on a pre-M7 workspace', async () => {
      const wsDir = path.join(ctx.tmpDir, 'backfill-test');
      await setupPreM7Workspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'Backfill Test', slug: 'backfill-test', docsDir: wsDir }).run();

      await backfillM7('backfill-test');

      // Check subtype dirs
      for (const subtype of MEMORY_SUBTYPES) {
        expect(
          fs.existsSync(path.join(wsDir, 'memory', subtype)),
          `expected memory/${subtype} to exist`,
        ).toBe(true);
      }

      // Check ingestion dirs
      for (const ingDir of INGESTION_DIRS) {
        expect(
          fs.existsSync(path.join(wsDir, 'memory', ingDir)),
          `expected memory/${ingDir} to exist`,
        ).toBe(true);
      }
    });

    it('[FR-WORKSPACE-120] should seed README.md in memory/ and all subdirs', async () => {
      const wsDir = path.join(ctx.tmpDir, 'readme-backfill-test');
      await setupPreM7Workspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'README Backfill', slug: 'readme-backfill-test', docsDir: wsDir }).run();

      await backfillM7('readme-backfill-test');

      expect(fs.existsSync(path.join(wsDir, 'memory', 'README.md'))).toBe(true);
      for (const subtype of MEMORY_SUBTYPES) {
        expect(
          fs.existsSync(path.join(wsDir, 'memory', subtype, 'README.md')),
        ).toBe(true);
      }
    });

    it('[FR-WORKSPACE-120] should commit the changes to git', async () => {
      const wsDir = path.join(ctx.tmpDir, 'commit-backfill-test');
      await setupPreM7Workspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'Commit Backfill', slug: 'commit-backfill-test', docsDir: wsDir }).run();

      await backfillM7('commit-backfill-test');

      const git = simpleGit(wsDir);
      const log = await git.log();
      const lastCommit = log.latest;
      expect(lastCommit?.message).toBe('memory(init): backfill knowledge-layer directories');
    });

    it('[FR-WORKSPACE-120] should backfill a workspace that never had a memory/ dir (no-memory-dir regression)', async () => {
      const wsDir = path.join(ctx.tmpDir, 'no-memory-backfill-test');
      await setupNoMemoryWorkspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'No Memory', slug: 'no-memory-backfill-test', docsDir: wsDir }).run();

      await backfillM7('no-memory-backfill-test');

      expect(fs.existsSync(path.join(wsDir, 'memory', 'README.md'))).toBe(true);
      for (const subtype of MEMORY_SUBTYPES) {
        expect(
          fs.existsSync(path.join(wsDir, 'memory', subtype)),
          `expected memory/${subtype} to exist`,
        ).toBe(true);
      }

      const git = simpleGit(wsDir);
      const log = await git.log();
      expect(log.latest?.message).toBe('memory(init): backfill knowledge-layer directories');
    });

    it('[FR-WORKSPACE-120] should stage and commit READMEs when memory/ exists as an untracked directory', async () => {
      // Regression: git status without --untracked-files=all collapses an untracked
      // memory/ directory to a single "memory/" entry. That path is captured in
      // beforePaths, so the afterStatus diff finds nothing new — the READMEs are
      // never staged and the commit is skipped.
      const wsDir = path.join(ctx.tmpDir, 'untracked-memory-test');

      // Set up a repo with memory/ present but NOT committed (untracked directory).
      fs.mkdirSync(path.join(wsDir, 'memory'), { recursive: true });
      fs.mkdirSync(path.join(wsDir, 'system'), { recursive: true });

      const git = simpleGit(wsDir);
      await git.init();
      await git.addConfig('user.name', 'Test');
      await git.addConfig('user.email', 'test@localhost');
      // Commit only a placeholder — memory/ stays untracked.
      fs.writeFileSync(path.join(wsDir, '.gitkeep'), '');
      await git.add('.gitkeep');
      await git.commit('initial commit without memory/');

      ctx.db
        .insert(workspaces)
        .values({ name: 'Untracked Memory', slug: 'untracked-memory-test', docsDir: wsDir })
        .run();

      await backfillM7('untracked-memory-test');

      // memory/README.md must exist and be committed.
      expect(fs.existsSync(path.join(wsDir, 'memory', 'README.md'))).toBe(true);

      const log = await git.log();
      expect(log.latest?.message).toBe('memory(init): backfill knowledge-layer directories');

      // Verify the commit contains the README files (not an empty commit).
      const showResult = await git.show(['--name-only', '--format=', 'HEAD']);
      expect(showResult).toContain('memory/README.md');
    });

    it('[FR-WORKSPACE-120] should be idempotent — second run does not fail or duplicate commits', async () => {
      const wsDir = path.join(ctx.tmpDir, 'idempotent-backfill-test');
      await setupPreM7Workspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'Idempotent', slug: 'idempotent-backfill-test', docsDir: wsDir }).run();

      await backfillM7('idempotent-backfill-test');
      const git = simpleGit(wsDir);
      const log1 = await git.log();

      // Second run should be a no-op (nothing new to commit)
      await backfillM7('idempotent-backfill-test');
      const log2 = await git.log();

      expect(log2.total).toBe(log1.total);
    });
  });
});
