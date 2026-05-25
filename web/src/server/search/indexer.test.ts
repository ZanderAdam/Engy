/**
 * Indexer tests — trophy-style BDD, no DB mocks.
 *
 * These tests use the real SQLite DB via setupTestDb() and write fixture
 * markdown files to a temporary workspace directory. The qmd update() pass
 * performs SHA-256 hash indexing (no embeddings needed for that path), so
 * these tests run offline without requiring model downloads.
 *
 * Embed-dependent assertions (vector embeddings) are gated behind
 * describe.skipIf(!QMD_AVAILABLE) — qmd embedding requires a local GGUF
 * model which is not available in CI. The hash-scan and frontmatter-sync
 * assertions run unconditionally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { appRouter } from '../trpc/root';
import { frontmatter, permanentMemories, workspaces, type FrontmatterCollection } from '../db/schema';
import { update, forceFullReindex, syncPermanentMemoryMirror, type IndexResult } from './indexer';
import { _resetStoreCache } from './qmd-store';

// QMD embedding requires a local GGUF model. Mark embed-only tests as
// skip when the model isn't present. Hash indexing works offline.
const QMD_AVAILABLE = process.env.QMD_AVAILABLE === '1';

describe('WorkspaceIndexer', () => {
  let ctx: TestContext;
  let workspaceSlug: string;
  let workspaceId: number;
  let wsDir: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    const caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Indexer Test WS' });
    workspaceSlug = ws.slug;

    // Resolve workspace id and dir from DB.
    const wsRow = ctx.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .get()!;
    workspaceId = wsRow.id;
    wsDir = path.join(ctx.tmpDir, workspaceSlug);
  });

  afterEach(() => {
    _resetStoreCache();
    ctx.cleanup();
  });

  // ── Helper to write a fixture markdown file ──────────────────────────

  function writeFixture(relPath: string, content: string): void {
    const abs = path.join(wsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  function readFrontmatterRows(collection: FrontmatterCollection) {
    return ctx.db
      .select()
      .from(frontmatter)
      .where(
        and(eq(frontmatter.workspaceId, workspaceId), eq(frontmatter.collection, collection)),
      )
      .all();
  }

  // ── Tests ─────────────────────────────────────────────────────────────

  describe('update()', () => {
    describe('frontmatter table sync', () => {
      it('should insert a frontmatter row for a new markdown file with frontmatter', async () => {
        writeFixture(
          'docs/auth-guide.md',
          `---\ntitle: Auth Guide\ntags: [auth, jwt]\n---\n\n# Auth Guide\n`,
        );

        await update(workspaceSlug, 'docs');

        const rows = readFrontmatterRows('docs');
        expect(rows).toHaveLength(1);

        const row = rows[0];
        expect(row.collection).toBe('docs');
        expect(row.path).toBe('docs/auth-guide.md');

        const data = JSON.parse(row.data);
        expect(data.title).toBe('Auth Guide');
        expect(data.tags).toEqual(['auth', 'jwt']);
      });

      it('should set the correct collection for system files', async () => {
        writeFixture(
          'system/overview.md',
          `---\ntitle: Overview\n---\n\n# Overview\n`,
        );

        await update(workspaceSlug, 'system');

        const rows = readFrontmatterRows('system');
        const overview = rows.find((r) => r.path === 'system/overview.md');
        expect(overview).toBeDefined();
        expect(overview!.collection).toBe('system');
      });

      it('should handle files without frontmatter gracefully', async () => {
        writeFixture('docs/no-fm.md', '# Just a heading\n\nNo frontmatter here.\n');

        await update(workspaceSlug, 'docs');

        const rows = readFrontmatterRows('docs');
        const row = rows.find((r) => r.path === 'docs/no-fm.md');
        expect(row).toBeDefined();
        expect(JSON.parse(row!.data)).toEqual({});
      });

      it('should index files in subdirectories with correct workspace-relative paths', async () => {
        writeFixture(
          'docs/guides/setup.md',
          `---\ntitle: Setup Guide\n---\n`,
        );

        await update(workspaceSlug, 'docs');

        const rows = readFrontmatterRows('docs');
        const row = rows.find((r) => r.path === 'docs/guides/setup.md');
        expect(row).toBeDefined();
        expect(row!.path).not.toContain('\\'); // forward slashes only
      });
    });

    describe('idempotency', () => {
      it('should not create duplicate rows on a second run with unchanged files', async () => {
        writeFixture('docs/stable.md', `---\ntitle: Stable Doc\n---\n`);

        await update(workspaceSlug, 'docs');
        const firstRows = readFrontmatterRows('docs');
        const firstCount = firstRows.length;

        await update(workspaceSlug, 'docs');
        const secondRows = readFrontmatterRows('docs');

        expect(secondRows).toHaveLength(firstCount);
      });

      it('should update the frontmatter row when file content changes', async () => {
        writeFixture('docs/changing.md', `---\ntitle: Original\n---\n`);
        await update(workspaceSlug, 'docs');

        writeFixture('docs/changing.md', `---\ntitle: Updated\ntags: [new]\n---\n`);
        await update(workspaceSlug, 'docs');

        const rows = readFrontmatterRows('docs');
        const row = rows.find((r) => r.path === 'docs/changing.md');
        expect(row).toBeDefined();
        const data = JSON.parse(row!.data);
        expect(data.title).toBe('Updated');
        expect(data.tags).toEqual(['new']);
      });
    });

    describe('file removal', () => {
      it('should delete the frontmatter row when a file is removed', async () => {
        writeFixture('docs/soon-gone.md', `---\ntitle: Soon Gone\n---\n`);
        await update(workspaceSlug, 'docs');

        const before = readFrontmatterRows('docs');
        expect(before.find((r) => r.path === 'docs/soon-gone.md')).toBeDefined();

        fs.unlinkSync(path.join(wsDir, 'docs/soon-gone.md'));
        await update(workspaceSlug, 'docs');

        const after = readFrontmatterRows('docs');
        expect(after.find((r) => r.path === 'docs/soon-gone.md')).toBeUndefined();
      });
    });

    describe('all collections', () => {
      it('should index all four collections when no collection is specified', async () => {
        writeFixture('system/arch.md', `---\ntitle: Architecture\n---\n`);
        writeFixture('docs/guide.md', `---\ntitle: Guide\n---\n`);
        writeFixture('projects/alpha/spec.md', `---\ntitle: Alpha Spec\n---\n`);
        writeFixture('memory/decisions/001-decision.md', `---\ntitle: A Decision\nsubtype: decision\n---\n`);

        const results: IndexResult[] = await update(workspaceSlug);

        const collections = results.map((r) => r.collection).sort();
        expect(collections).toEqual(['docs', 'memory', 'projects', 'system']);

        expect(readFrontmatterRows('system').find((r) => r.path === 'system/arch.md')).toBeDefined();
        expect(readFrontmatterRows('docs').find((r) => r.path === 'docs/guide.md')).toBeDefined();
        expect(readFrontmatterRows('projects').find((r) => r.path === 'projects/alpha/spec.md')).toBeDefined();
        expect(readFrontmatterRows('memory').find((r) => r.path === 'memory/decisions/001-decision.md')).toBeDefined();
      });
    });

    describe('permanentMemories mirror', () => {
      it('should populate permanentMemories rows from memory collection files', async () => {
        writeFixture(
          'memory/facts/202501010001-use-typescript.md',
          `---\ntitle: Use TypeScript\nsubtype: fact\ntags: [typescript]\n---\n\nWe use TypeScript everywhere.\n`,
        );

        await update(workspaceSlug, 'memory');

        const rows = ctx.db
          .select()
          .from(permanentMemories)
          .where(eq(permanentMemories.workspaceId, workspaceId))
          .all();

        expect(rows.length).toBeGreaterThan(0);
        const row = rows.find((r) => r.filePath === 'memory/facts/202501010001-use-typescript.md');
        expect(row).toBeDefined();
        expect(row!.title).toBe('Use TypeScript');
        expect(row!.subtype).toBe('fact');
        expect(row!.tags).toEqual(['typescript']);
      });

      it('should NOT populate permanentMemories for non-memory collections', async () => {
        writeFixture('docs/plain-doc.md', `---\ntitle: Plain Doc\n---\n`);

        await update(workspaceSlug, 'docs');

        const rows = ctx.db
          .select()
          .from(permanentMemories)
          .where(eq(permanentMemories.workspaceId, workspaceId))
          .all();

        expect(rows).toHaveLength(0);
      });

      it('should remove permanentMemory row when memory file is deleted', async () => {
        const memFile = 'memory/patterns/202501010002-some-pattern.md';
        writeFixture(
          memFile,
          `---\ntitle: Some Pattern\nsubtype: pattern\n---\n\nPattern content.\n`,
        );

        await update(workspaceSlug, 'memory');

        const before = ctx.db
          .select()
          .from(permanentMemories)
          .where(
            and(
              eq(permanentMemories.workspaceId, workspaceId),
              eq(permanentMemories.filePath, memFile),
            ),
          )
          .get();
        expect(before).toBeDefined();

        fs.unlinkSync(path.join(wsDir, memFile));
        await update(workspaceSlug, 'memory');

        const after = ctx.db
          .select()
          .from(permanentMemories)
          .where(
            and(
              eq(permanentMemories.workspaceId, workspaceId),
              eq(permanentMemories.filePath, memFile),
            ),
          )
          .get();
        expect(after).toBeUndefined();
      });
    });

    describe('backfill (pre-existing files)', () => {
      it('should populate frontmatter table from pre-existing workspace files on first update', async () => {
        // Simulate a workspace that already has content before indexer runs.
        writeFixture('system/old-doc.md', `---\ntitle: Old Doc\ndescription: legacy\n---\n`);
        writeFixture('docs/old-guide.md', `---\ntitle: Old Guide\n---\n`);
        writeFixture('memory/conventions/202501010003-naming.md', `---\ntitle: Naming Convention\nsubtype: convention\n---\n`);

        // First ever update on this workspace.
        await update(workspaceSlug);

        expect(readFrontmatterRows('system').find((r) => r.path === 'system/old-doc.md')).toBeDefined();
        expect(readFrontmatterRows('docs').find((r) => r.path === 'docs/old-guide.md')).toBeDefined();
        expect(
          readFrontmatterRows('memory').find(
            (r) => r.path === 'memory/conventions/202501010003-naming.md',
          ),
        ).toBeDefined();

        const memRow = ctx.db
          .select()
          .from(permanentMemories)
          .where(eq(permanentMemories.workspaceId, workspaceId))
          .all()
          .find((r) => r.filePath === 'memory/conventions/202501010003-naming.md');
        expect(memRow).toBeDefined();
        expect(memRow!.subtype).toBe('convention');
      });
    });

    describe('qmd counts propagated', () => {
      it('should return positive indexed count after indexing new files', async () => {
        writeFixture('docs/new1.md', `---\ntitle: Doc 1\n---\n`);
        writeFixture('docs/new2.md', `---\ntitle: Doc 2\n---\n`);

        const results = await update(workspaceSlug, 'docs');
        const docsResult = results.find((r) => r.collection === 'docs')!;

        expect(docsResult.indexed + docsResult.updated).toBeGreaterThanOrEqual(1);
      });

      it('should return unchanged > 0 on second run with unmodified files', async () => {
        writeFixture('docs/stable2.md', `---\ntitle: Stable\n---\n`);

        await update(workspaceSlug, 'docs');
        const secondResults = await update(workspaceSlug, 'docs');
        const docsResult = secondResults.find((r) => r.collection === 'docs')!;

        expect(docsResult.unchanged).toBeGreaterThan(0);
      });
    });
  });

  describe('syncPermanentMemoryMirror()', () => {
    it('should upsert memory rows from all subtype directories', async () => {
      writeFixture(
        'memory/decisions/202501010010-db-choice.md',
        `---\ntitle: DB Choice\nsubtype: decision\nrepo: api-server\n---\n\nWe chose SQLite.\n`,
      );
      writeFixture(
        'memory/insights/202501010011-fast-feedback.md',
        `---\ntitle: Fast Feedback Matters\nsubtype: insight\n---\n\nFast feedback loops improve DX.\n`,
      );

      await syncPermanentMemoryMirror(workspaceSlug);

      const rows = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.workspaceId, workspaceId))
        .all();

      const dbChoice = rows.find((r) => r.filePath === 'memory/decisions/202501010010-db-choice.md');
      expect(dbChoice).toBeDefined();
      expect(dbChoice!.title).toBe('DB Choice');
      expect(dbChoice!.subtype).toBe('decision');
      expect(dbChoice!.repo).toBe('api-server');

      const insight = rows.find((r) => r.filePath === 'memory/insights/202501010011-fast-feedback.md');
      expect(insight).toBeDefined();
      expect(insight!.title).toBe('Fast Feedback Matters');
    });

    it('should be idempotent — running twice does not duplicate rows', async () => {
      writeFixture(
        'memory/facts/202501010020-fact.md',
        `---\ntitle: A Fact\nsubtype: fact\n---\n`,
      );

      await syncPermanentMemoryMirror(workspaceSlug);
      await syncPermanentMemoryMirror(workspaceSlug);

      const rows = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.workspaceId, workspaceId))
        .all()
        .filter((r) => r.filePath === 'memory/facts/202501010020-fact.md');

      expect(rows).toHaveLength(1);
    });

    it('should skip README.md files and only index real memory files', async () => {
      writeFixture(
        'memory/decisions/README.md',
        `# Decisions\n\nThis folder contains decision records.\n`,
      );
      writeFixture(
        'memory/decisions/a-real-decision.md',
        `---\ntitle: A Real Decision\nsubtype: decision\n---\n\nWe decided something important.\n`,
      );

      await syncPermanentMemoryMirror(workspaceSlug);

      const rows = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.workspaceId, workspaceId))
        .all();

      expect(rows.find((r) => r.filePath === 'memory/decisions/README.md')).toBeUndefined();
      expect(rows.find((r) => r.filePath === 'memory/decisions/a-real-decision.md')).toBeDefined();
    });

    it('should NOT create rows for files in memory/sources/ or memory/references/', async () => {
      writeFixture(
        'memory/sources/202501010030-source.md',
        `---\ntitle: A Source\nurl: https://example.com\nsource_type: article\n---\n`,
      );
      writeFixture(
        'memory/references/some-ref.md',
        `---\ntitle: A Reference\nurl: https://example.com\ntype: doc\n---\n`,
      );

      await syncPermanentMemoryMirror(workspaceSlug);

      const rows = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.workspaceId, workspaceId))
        .all();

      // sources and references are not permanent memory subtypes
      expect(rows.filter((r) => r.filePath?.includes('/sources/'))).toHaveLength(0);
      expect(rows.filter((r) => r.filePath?.includes('/references/'))).toHaveLength(0);
    });

    it('should preserve supersededById on re-sync (disk has no concept of supersession)', async () => {
      const memFile = 'memory/facts/202501010040-old-fact.md';
      writeFixture(
        memFile,
        `---\ntitle: Old Fact\nsubtype: fact\n---\n\nThis was the old fact.\n`,
      );

      // First sync: creates the row with supersededById = null
      await syncPermanentMemoryMirror(workspaceSlug);

      const firstSync = ctx.db
        .select()
        .from(permanentMemories)
        .where(and(eq(permanentMemories.workspaceId, workspaceId), eq(permanentMemories.filePath, memFile)))
        .get();
      expect(firstSync).toBeDefined();
      expect(firstSync!.supersededById).toBeNull();

      // Simulate supersession: set supersededById to a non-null value in the DB
      const replacementRow = ctx.db
        .insert(permanentMemories)
        .values({
          workspaceId,
          subtype: 'fact',
          title: 'New Fact',
          content: 'Replacement content',
          filePath: 'memory/facts/202501010041-new-fact.md',
        })
        .returning()
        .get();

      ctx.db
        .update(permanentMemories)
        .set({ supersededById: replacementRow.id })
        .where(eq(permanentMemories.id, firstSync!.id))
        .run();

      // Re-sync: the file still exists on disk; supersededById must NOT be reset to null
      await syncPermanentMemoryMirror(workspaceSlug);

      const afterResync = ctx.db
        .select()
        .from(permanentMemories)
        .where(and(eq(permanentMemories.workspaceId, workspaceId), eq(permanentMemories.filePath, memFile)))
        .get();
      expect(afterResync).toBeDefined();
      expect(afterResync!.supersededById).toBe(replacementRow.id);
    });
  });

  describe('forceFullReindex()', () => {
    it('should rebuild qmd index from scratch and repopulate frontmatter table', async () => {
      writeFixture('system/spec.md', `---\ntitle: Spec\n---\n`);
      writeFixture('docs/ref.md', `---\ntitle: Ref\n---\n`);

      // First index
      await update(workspaceSlug);

      // Force full reindex
      const results = await forceFullReindex(workspaceSlug);

      expect(results).toHaveLength(4);
      expect(results.every((r) => r.collection !== undefined)).toBe(true);

      // Frontmatter table should still be populated
      expect(readFrontmatterRows('system').find((r) => r.path === 'system/spec.md')).toBeDefined();
      expect(readFrontmatterRows('docs').find((r) => r.path === 'docs/ref.md')).toBeDefined();
    });
  });

  describe.skipIf(!QMD_AVAILABLE)('embed-dependent assertions', () => {
    it('should report needsEmbedding count after index without embed', async () => {
      writeFixture('docs/embed-test.md', `---\ntitle: Embed Test\n---\n\nContent to embed.\n`);

      const results = await update(workspaceSlug, 'docs');
      const docsResult = results.find((r) => r.collection === 'docs')!;

      expect(docsResult.needsEmbedding).toBeGreaterThan(0);
    });
  });
});
