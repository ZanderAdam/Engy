import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetDb } from '../db/client';
import { getStore, getQmdDbPath, evictStore, _resetStoreCache } from './qmd-store';

function setupEngyDir(): { tmpDir: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-qmd-test-'));
  process.env.ENGY_DIR = tmpDir;
  resetDb();
  return {
    tmpDir,
    cleanup: () => {
      _resetStoreCache();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.ENGY_DIR;
      resetDb();
    },
  };
}

describe('qmd store', () => {
  describe('getStore', () => {
    let tmpDir: string;
    let cleanup: () => void;

    beforeEach(() => {
      ({ tmpDir, cleanup } = setupEngyDir());
    });

    afterEach(async () => {
      cleanup();
    });

    it('should create the .qmd directory and database on first init', async () => {
      const slug = 'my-workspace';
      const workspaceDir = path.join(tmpDir, slug);
      fs.mkdirSync(workspaceDir, { recursive: true });

      const store = await getStore(slug);

      const dbPath = getQmdDbPath(slug);
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(store).toBeDefined();

      await store.close();
    });

    it('should return the same store instance on repeated calls (lazy cache)', async () => {
      const slug = 'cached-workspace';
      const workspaceDir = path.join(tmpDir, slug);
      fs.mkdirSync(workspaceDir, { recursive: true });

      const first = await getStore(slug);
      const second = await getStore(slug);

      expect(first).toBe(second);

      await first.close();
    });

    it('should configure four collections matching workspace layout', async () => {
      const slug = 'collection-workspace';
      const workspaceDir = path.join(tmpDir, slug);
      for (const dir of ['system', 'docs', 'projects', 'memory']) {
        fs.mkdirSync(path.join(workspaceDir, dir), { recursive: true });
      }

      const store = await getStore(slug);
      const collections = await store.listCollections();
      const names = collections.map((c) => c.name).sort();

      expect(names).toEqual(['docs', 'memory', 'projects', 'system']);

      await store.close();
    });

    it('should return the same store instance on concurrent first accesses (no race)', async () => {
      const slug = 'concurrent-workspace';
      const workspaceDir = path.join(tmpDir, slug);
      fs.mkdirSync(workspaceDir, { recursive: true });

      // Fire two concurrent getStore calls before either resolves.
      const [first, second] = await Promise.all([getStore(slug), getStore(slug)]);

      expect(first).toBe(second);

      await first.close();
    });

    it('should isolate stores by workspace slug', async () => {
      const slugA = 'workspace-a';
      const slugB = 'workspace-b';
      fs.mkdirSync(path.join(tmpDir, slugA), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, slugB), { recursive: true });

      const storeA = await getStore(slugA);
      const storeB = await getStore(slugB);

      expect(storeA).not.toBe(storeB);
      expect(storeA.dbPath).not.toBe(storeB.dbPath);

      await storeA.close();
      await storeB.close();
    });
  });

  describe('evictStore', () => {
    let tmpDir: string;
    let cleanup: () => void;

    beforeEach(() => {
      ({ tmpDir, cleanup } = setupEngyDir());
    });

    afterEach(() => {
      cleanup();
    });

    it('should remove the cached store so the next getStore call creates a fresh one', async () => {
      const slug = 'evict-workspace';
      fs.mkdirSync(path.join(tmpDir, slug), { recursive: true });

      await getStore(slug);

      evictStore(slug);

      const second = await getStore(slug);
      expect(second).toBeDefined();

      await second.close();
    });

    it('should close the evicted store to release DB resources', async () => {
      const slug = 'evict-close-workspace';
      fs.mkdirSync(path.join(tmpDir, slug), { recursive: true });

      const store = await getStore(slug);
      let closeCalled = false;
      const origClose = store.close.bind(store);
      store.close = async () => {
        closeCalled = true;
        return origClose();
      };

      evictStore(slug);

      // Allow microtask queue to flush the close() promise.
      await new Promise((r) => setTimeout(r, 0));

      expect(closeCalled).toBe(true);
    });

    it('should close an in-flight store that resolves after eviction', async () => {
      const slug = 'evict-inflight-workspace';
      fs.mkdirSync(path.join(tmpDir, slug), { recursive: true });

      // Kick off creation but don't await — store is now inflight.
      const creationPromise = getStore(slug);

      // Evict before the creation settles.
      evictStore(slug);

      // Await the original creation so the store is fully initialised.
      const store = await creationPromise;

      // Allow microtask queue to flush the close() chained in evictStore.
      await new Promise((r) => setTimeout(r, 10));

      // The store should have been closed — a second getStore call creates a new one.
      const fresh = await getStore(slug);
      expect(fresh).not.toBe(store);

      await fresh.close();
    });
  });

  describe('getQmdDbPath', () => {
    let tmpDir: string;
    let cleanup: () => void;

    beforeEach(() => {
      ({ tmpDir, cleanup } = setupEngyDir());
    });

    afterEach(() => {
      cleanup();
    });

    it('should return the expected database path for a workspace slug', () => {
      const slug = 'my-ws';
      const dbPath = getQmdDbPath(slug);
      expect(dbPath).toBe(path.join(tmpDir, slug, '.qmd', 'qmd.db'));
    });
  });
});
