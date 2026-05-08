import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { workspaces, permanentMemories, frontmatter } from '../db/schema';
import { appRouter } from '../trpc/root';
import { autoLink, SIMILARITY_THRESHOLD, MAX_LINKS } from './auto-linker';
import { _resetStoreCache } from './qmd-store';

// ── Module mocks ──────────────────────────────────────────────────────

vi.mock('./qmd-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./qmd-store')>();
  return {
    ...actual,
    getStore: vi.fn(),
  };
});

import { getStore } from './qmd-store';
const mockGetStore = getStore as MockedFunction<typeof getStore>;

// ── Helpers ───────────────────────────────────────────────────────────

function makeSearchResult(displayPath: string, score: number, title = 'Memory') {
  return {
    file: `qmd://memory/${displayPath}`,
    displayPath,
    title,
    body: 'content',
    bestChunk: 'content',
    bestChunkPos: 0,
    score,
    context: {},
    docid: displayPath,
  };
}

function writeMemoryFile(wsDir: string, relPath: string, title: string, linkedMemories: string[] = []) {
  const absPath = path.join(wsDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fm = [
    '---',
    `title: ${title}`,
    `subtype: fact`,
    `linkedMemories: [${linkedMemories.map((l) => `'${l}'`).join(', ')}]`,
    'keywords: []',
    'themes: []',
    'tags: []',
    'scenarioIds: []',
    'sources: []',
    '---',
    '',
    `Content of ${title}.`,
  ].join('\n');
  fs.writeFileSync(absPath, fm, 'utf8');
}

function readLinkedMemories(wsDir: string, relPath: string): string[] {
  const absPath = path.join(wsDir, relPath);
  if (!fs.existsSync(absPath)) return [];
  const raw = fs.readFileSync(absPath, 'utf8');
  // Simple extraction: find linkedMemories line
  const match = raw.match(/^linkedMemories:\s*\[([^\]]*)\]/m);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

describe('auto-linker', () => {
  let ctx: TestContext;
  let wsDir: string;
  let wsSlug: string;
  let wsId: number;

  beforeEach(async () => {
    ctx = setupTestDb();
    vi.clearAllMocks();
    // autoLink checks QMD_SKIP to guard against slow model init in tests.
    // We mock getStore so there's no actual model loading — safe to unset.
    delete process.env.QMD_SKIP;

    const caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Auto Link WS' });
    wsSlug = ws.slug;

    const db = getDb();
    const wsRow = db.select().from(workspaces).where(eq(workspaces.slug, ws.slug)).get()!;
    wsId = wsRow.id;
    wsDir = path.join(ctx.tmpDir, wsSlug);
  });

  afterEach(() => {
    _resetStoreCache();
    ctx.cleanup();
    process.env.QMD_SKIP = '1';
  });

  describe('constants', () => {
    it('should export SIMILARITY_THRESHOLD as 0.75', () => {
      expect(SIMILARITY_THRESHOLD).toBe(0.75);
    });

    it('should export MAX_LINKS as 5', () => {
      expect(MAX_LINKS).toBe(5);
    });
  });

  describe('QMD_SKIP guard', () => {
    it('should return early when QMD_SKIP=1', async () => {
      // Re-set it to test the guard (beforeEach cleared it for mock-based tests)
      process.env.QMD_SKIP = '1';
      const db = getDb();
      const mem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Skip Test', content: 'body', filePath: 'memory/facts/skip.md' })
        .returning()
        .get();

      await autoLink(mem.id, wsSlug);
      expect(mockGetStore).not.toHaveBeenCalled();
    });
  });

  describe('autoLink', () => {
    it('should write bidirectional links when score is above threshold', async () => {
      const db = getDb();

      // Create source memory
      const srcPath = 'memory/facts/202501010001-source.md';
      writeMemoryFile(wsDir, srcPath, 'Source Memory');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Source Memory', content: 'important fact about auth', filePath: srcPath })
        .returning()
        .get();

      // Create candidate memory
      const candidatePath = 'memory/facts/202501010002-candidate.md';
      writeMemoryFile(wsDir, candidatePath, 'Candidate Memory');
      const candidateMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Candidate Memory', content: 'related auth fact', filePath: candidatePath })
        .returning()
        .get();

      const mockStore = {
        search: vi.fn().mockResolvedValue([
          makeSearchResult('facts/202501010002-candidate.md', 0.9, 'Candidate Memory'),
        ]),
      };
      mockGetStore.mockResolvedValue(mockStore as any);

      await autoLink(srcMem.id, wsSlug);

      // Source memory should link to candidate
      const updatedSrc = db.select().from(permanentMemories).where(eq(permanentMemories.id, srcMem.id)).get()!;
      expect(updatedSrc.linkedMemories).toContain(candidatePath);

      // Candidate memory should link back to source
      const updatedCandidate = db.select().from(permanentMemories).where(eq(permanentMemories.id, candidateMem.id)).get()!;
      expect(updatedCandidate.linkedMemories).toContain(srcPath);
    });

    it('should not link when score is below similarity threshold', async () => {
      const db = getDb();

      const srcPath = 'memory/facts/202501010001-below.md';
      writeMemoryFile(wsDir, srcPath, 'Below Threshold Memory');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Below Threshold Memory', content: 'body', filePath: srcPath })
        .returning()
        .get();

      const candidatePath = 'memory/facts/202501010002-low.md';
      writeMemoryFile(wsDir, candidatePath, 'Low Score Memory');
      db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Low Score Memory', content: 'unrelated body', filePath: candidatePath })
        .returning()
        .get();

      const mockStore = {
        search: vi.fn().mockResolvedValue([
          makeSearchResult('facts/202501010002-low.md', 0.5, 'Low Score Memory'),
        ]),
      };
      mockGetStore.mockResolvedValue(mockStore as any);

      await autoLink(srcMem.id, wsSlug);

      const updatedSrc = db.select().from(permanentMemories).where(eq(permanentMemories.id, srcMem.id)).get()!;
      expect((updatedSrc.linkedMemories as string[]) ?? []).not.toContain(candidatePath);
    });

    it('should cap links at MAX_LINKS even when many candidates qualify', async () => {
      const db = getDb();

      const srcPath = 'memory/facts/202501010001-src.md';
      writeMemoryFile(wsDir, srcPath, 'Source');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Source', content: 'body', filePath: srcPath })
        .returning()
        .get();

      // Create 7 candidates (more than MAX_LINKS=5)
      const candidatePaths: string[] = [];
      for (let i = 2; i <= 8; i++) {
        const relPath = `memory/facts/20250101000${i}-cand${i}.md`;
        candidatePaths.push(relPath);
        writeMemoryFile(wsDir, relPath, `Cand ${i}`);
        db.insert(permanentMemories)
          .values({ workspaceId: wsId, subtype: 'fact', title: `Cand ${i}`, content: 'body', filePath: relPath })
          .run();
      }

      const mockStore = {
        search: vi.fn().mockResolvedValue(
          candidatePaths.map((p, idx) =>
            makeSearchResult(`facts/${p.split('/').pop()!}`, 0.95 - idx * 0.01, `Cand ${idx + 2}`),
          ),
        ),
      };
      mockGetStore.mockResolvedValue(mockStore as any);

      await autoLink(srcMem.id, wsSlug);

      const updated = db.select().from(permanentMemories).where(eq(permanentMemories.id, srcMem.id)).get()!;
      const links = (updated.linkedMemories as string[]) ?? [];
      expect(links.length).toBeLessThanOrEqual(MAX_LINKS);
    });

    it('should use set semantics — running autoLink twice does not duplicate links', async () => {
      const db = getDb();

      const srcPath = 'memory/facts/202501010001-dedup.md';
      writeMemoryFile(wsDir, srcPath, 'Dedup Source');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Dedup Source', content: 'body', filePath: srcPath })
        .returning()
        .get();

      const candidatePath = 'memory/facts/202501010002-dedup-cand.md';
      writeMemoryFile(wsDir, candidatePath, 'Dedup Candidate');
      db.insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Dedup Candidate', content: 'body', filePath: candidatePath })
        .run();

      const mockStore = {
        search: vi.fn().mockResolvedValue([
          makeSearchResult('facts/202501010002-dedup-cand.md', 0.92, 'Dedup Candidate'),
        ]),
      };
      mockGetStore.mockResolvedValue(mockStore as any);

      // Run twice
      await autoLink(srcMem.id, wsSlug);
      await autoLink(srcMem.id, wsSlug);

      const updated = db.select().from(permanentMemories).where(eq(permanentMemories.id, srcMem.id)).get()!;
      const links = (updated.linkedMemories as string[]) ?? [];
      const unique = new Set(links);
      expect(unique.size).toBe(links.length);
      expect(links.filter((l) => l === candidatePath).length).toBe(1);
    });

    it('should not self-link', async () => {
      const db = getDb();

      const srcPath = 'memory/facts/202501010001-self.md';
      writeMemoryFile(wsDir, srcPath, 'Self Memory');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Self Memory', content: 'body', filePath: srcPath })
        .returning()
        .get();

      const mockStore = {
        search: vi.fn().mockResolvedValue([
          // Same file returned from qmd (score above threshold)
          makeSearchResult('facts/202501010001-self.md', 0.99, 'Self Memory'),
        ]),
      };
      mockGetStore.mockResolvedValue(mockStore as any);

      await autoLink(srcMem.id, wsSlug);

      const updated = db.select().from(permanentMemories).where(eq(permanentMemories.id, srcMem.id)).get()!;
      expect((updated.linkedMemories as string[]) ?? []).not.toContain(srcPath);
    });

    it('should return early when memory has no filePath', async () => {
      const db = getDb();
      const mem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'No Path', content: 'body' })
        .returning()
        .get();

      await autoLink(mem.id, wsSlug);
      expect(mockGetStore).not.toHaveBeenCalled();
    });

    it('should return early for non-existent memory id', async () => {
      await autoLink(99999, wsSlug);
      expect(mockGetStore).not.toHaveBeenCalled();
    });

    it('should handle qmd store.search failure gracefully without throwing', async () => {
      const db = getDb();

      const srcPath = 'memory/facts/202501010001-err.md';
      writeMemoryFile(wsDir, srcPath, 'Error Memory');
      const srcMem = db
        .insert(permanentMemories)
        .values({ workspaceId: wsId, subtype: 'fact', title: 'Error Memory', content: 'body', filePath: srcPath })
        .returning()
        .get();

      const mockStore = { search: vi.fn().mockRejectedValue(new Error('qmd error')) };
      mockGetStore.mockResolvedValue(mockStore as any);

      await expect(autoLink(srcMem.id, wsSlug)).resolves.toBeUndefined();
    });
  });

  describe('recursion bound', () => {
    it('should not be called from the indexer (only callable from memory router)', () => {
      // The indexer module should not import autoLink — check at module level
      // This is a structural test: we verify the indexer file doesn't call autoLink
      // by checking that autoLink is not exported from the indexer module.
      // The actual recursion bound is structural: indexer.ts never imports auto-linker.ts.
      // We verify by checking the imports in the indexer module don't include auto-linker.
      const indexerPath = path.resolve(
        path.join(path.dirname(new URL(import.meta.url).pathname), 'indexer.ts'),
      );
      if (fs.existsSync(indexerPath)) {
        const content = fs.readFileSync(indexerPath, 'utf8');
        expect(content).not.toContain('auto-linker');
      }
    });
  });
});
