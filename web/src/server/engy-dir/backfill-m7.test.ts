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

describe('backfill-m7', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
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

    it('should return false when memory/ does not exist', () => {
      const dir = path.join(ctx.tmpDir, 'no-memory-ws');
      fs.mkdirSync(dir, { recursive: true });
      expect(needsM7Backfill(dir)).toBe(false);
    });
  });

  describe('backfillM7', () => {
    it('should throw for unknown workspace slug', async () => {
      await expect(backfillM7('nonexistent-slug')).rejects.toThrow('Workspace not found');
    });

    it('should create all M7 subdirectory structure on a pre-M7 workspace', async () => {
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

    it('should seed README.md in memory/ and all subdirs', async () => {
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

    it('should commit the changes to git', async () => {
      const wsDir = path.join(ctx.tmpDir, 'commit-backfill-test');
      await setupPreM7Workspace(wsDir);

      ctx.db.insert(workspaces).values({ name: 'Commit Backfill', slug: 'commit-backfill-test', docsDir: wsDir }).run();

      await backfillM7('commit-backfill-test');

      const git = simpleGit(wsDir);
      const log = await git.log();
      const lastCommit = log.latest;
      expect(lastCommit?.message).toBe('memory(init): backfill M7 directories');
    });

    it('should be idempotent — second run does not fail or duplicate commits', async () => {
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
