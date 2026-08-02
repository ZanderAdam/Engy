import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { permanentMemories, fleetingMemories } from '../../db/schema';
import { _resetStoreCache } from '../../search/qmd-store';
import {
  update as indexerUpdate,
  triggerMemoryIndexOnWrite,
  _flushMemoryIndexOnWrite,
} from '../../search/indexer';

vi.mock('../../lib/promote-proposal', () => ({
  proposeMemoryMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../search/indexer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../search/indexer')>();
  return {
    ...actual,
    update: vi.fn(actual.update),
    triggerMemoryIndexOnWrite: vi.fn(actual.triggerMemoryIndexOnWrite),
  };
});

const QMD_AVAILABLE = process.env.QMD_AVAILABLE === '1';

describe('memory router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceSlug: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Memory Test WS' });
    workspaceSlug = ws.slug;
  });

  afterEach(async () => {
    // Flush any fire-and-forget index-on-write runs before the DB is torn
    // down — getDb() is a process-global singleton the next test swaps out,
    // so a leftover run could otherwise resolve against the next test's DB.
    await _flushMemoryIndexOnWrite();
    _resetStoreCache();
    ctx.cleanup();
  });

  describe('create', () => {
    it('[FR-MEMORY-030] should insert a DB row and write a file', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'JWT expiry is 1 hour',
        content: 'All JWTs issued by the auth service expire after 1 hour.',
        tags: ['auth', 'jwt'],
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.title).toBe('JWT expiry is 1 hour');
      expect(result.subtype).toBe('fact');
      expect(result.filePath).toBeTruthy();

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, result.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('JWT expiry is 1 hour');
      expect(raw).toContain('fact');
    });

    it('should place the file under memory/facts/ for fact subtype', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'A fact memory',
        content: 'Some fact content',
      });
      expect(result.filePath).toMatch(/^memory\/facts\//);
    });

    it('should place file under correct subtype dir for each subtype', async () => {
      const subtypes = ['decision', 'pattern', 'convention', 'insight'] as const;
      for (const subtype of subtypes) {
        const mem = await caller.memory.create({
          workspaceSlug,
          subtype,
          title: `A ${subtype} memory`,
          content: `Content for ${subtype}`,
        });
        expect(mem.filePath).toMatch(new RegExp(`^memory/${subtype}s/`));
      }
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.create({
          workspaceSlug: 'no-such-ws',
          subtype: 'fact',
          title: 'X',
          content: 'Y',
        }),
      ).rejects.toThrow('not found');
    });

    it('[FR-MEMORY-040] should leave no orphan DB row when file write fails', async () => {
      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const memoryDir = path.join(wsDir, 'memory', 'facts');

      // Ensure the parent directory exists, then make it unwritable so
      // writePermanentMemory throws on the file create.
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.chmodSync(memoryDir, 0o555);

      try {
        await expect(
          caller.memory.create({
            workspaceSlug,
            subtype: 'fact',
            title: 'Orphan test fact',
            content: 'This write should fail.',
          }),
        ).rejects.toThrow();
      } finally {
        fs.chmodSync(memoryDir, 0o755);
      }

      const rows = ctx.db.select().from(permanentMemories).all();
      expect(rows).toHaveLength(0);
    });

    it('should store all optional metadata fields', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'decision',
        title: 'Use PostgreSQL',
        content: 'We chose PostgreSQL over MySQL for JSONB support.',
        repo: 'api-server',
        confidence: 0.9,
        keywords: ['database', 'postgresql'],
        themes: ['persistence', 'infrastructure'],
        tags: ['db', 'decision'],
        scenarioIds: ['FR-3.1'],
      });

      expect(result.repo).toBe('api-server');
      expect(result.confidence).toBe(0.9);
      expect(result.keywords).toEqual(['database', 'postgresql']);
      expect(result.themes).toEqual(['persistence', 'infrastructure']);
      expect(result.tags).toEqual(['db', 'decision']);
      expect(result.scenarioIds).toEqual(['FR-3.1']);
    });

    it('[FR-MEMORY-240] should trigger index-on-write after creating', async () => {
      const mockTrigger = vi.mocked(triggerMemoryIndexOnWrite);
      mockTrigger.mockClear();

      await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Index-on-write create fact',
        content: 'Should trigger the indexer.',
      });

      expect(mockTrigger).toHaveBeenCalledWith(workspaceSlug);
    });
  });

  describe('get', () => {
    it('should return a memory by id', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'insight',
        title: 'Caching insight',
        content: 'Cache invalidation is hard.',
      });

      const result = await caller.memory.get({ id: created.id });
      expect(result.id).toBe(created.id);
      expect(result.title).toBe('Caching insight');
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(caller.memory.get({ id: 99999 })).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('[FR-MEMORY-050] should update DB row and rewrite file', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Original title',
        content: 'Original content',
      });

      const updated = await caller.memory.update({
        id: created.id,
        title: 'Updated title',
        content: 'Updated content',
        tags: ['updated-tag'],
      });

      expect(updated.title).toBe('Updated title');
      expect(updated.content).toBe('Updated content');
      expect(updated.tags).toEqual(['updated-tag']);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, created.filePath!);
      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('Updated title');
      expect(raw).toContain('Updated content');
    });

    it('should rewrite the file in place (same path, no orphan)', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'In-place update',
        content: 'Original',
      });

      const originalPath = created.filePath!;

      await caller.memory.update({
        id: created.id,
        content: 'Updated in place',
      });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      // Original file is still there
      expect(fs.existsSync(path.join(wsDir, originalPath))).toBe(true);
      const raw = fs.readFileSync(path.join(wsDir, originalPath), 'utf8');
      expect(raw).toContain('Updated in place');

      // Only one non-README file in the subtype dir
      const subtypeDir = path.join(wsDir, 'memory', 'facts');
      const mdFiles = fs.readdirSync(subtypeDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
      expect(mdFiles).toHaveLength(1);
    });

    it('[FR-MEMORY-050] should merge partial updates, preserving existing fields', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Keep me',
        content: 'Keep this',
        repo: 'some-repo',
        confidence: 0.8,
      });

      const updated = await caller.memory.update({
        id: created.id,
        tags: ['new-tag'],
      });

      expect(updated.title).toBe('Keep me');
      expect(updated.content).toBe('Keep this');
      expect(updated.repo).toBe('some-repo');
      expect(updated.confidence).toBe(0.8);
      expect(updated.tags).toEqual(['new-tag']);
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(
        caller.memory.update({ id: 99999, title: 'X' }),
      ).rejects.toThrow('not found');
    });

    it('should set supersededById when provided', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Old fact',
        content: 'Old content',
      });
      const replacement = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'New fact',
        content: 'New content',
      });

      const updated = await caller.memory.update({
        id: created.id,
        supersededById: replacement.id,
      });

      expect(updated.supersededById).toBe(replacement.id);
    });

    it('[FR-MEMORY-070] should write supersededBy path to markdown frontmatter when supersededById is set', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Superseded Fact',
        content: 'This is the old content.',
      });
      const replacement = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Replacement Fact',
        content: 'This is the new content.',
      });

      await caller.memory.update({
        id: created.id,
        supersededById: replacement.id,
      });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const raw = fs.readFileSync(path.join(wsDir, created.filePath!), 'utf8');
      expect(raw).toContain('supersededBy:');
      expect(raw).toContain(replacement.filePath!);
    });

    it('[FR-MEMORY-070] should preserve supersededBy in frontmatter on an unrelated edit', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Superseded Fact',
        content: 'Old content.',
      });
      const replacement = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Replacement Fact',
        content: 'New content.',
      });
      await caller.memory.update({ id: created.id, supersededById: replacement.id });

      // Edit something unrelated WITHOUT re-passing supersededById.
      await caller.memory.update({ id: created.id, title: 'Superseded Fact (retitled)' });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const raw = fs.readFileSync(path.join(wsDir, created.filePath!), 'utf8');
      expect(raw).toContain('supersededBy:');
      expect(raw).toContain(replacement.filePath!);

      const row = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, created.id))
        .get();
      expect(row!.supersededById).toBe(replacement.id);
    });

    it('[FR-MEMORY-240] should trigger index-on-write after updating', async () => {
      const mockTrigger = vi.mocked(triggerMemoryIndexOnWrite);
      mockTrigger.mockClear();

      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Reindex trigger fact',
        content: 'Original for reindex test',
      });

      mockTrigger.mockClear();

      await caller.memory.update({
        id: created.id,
        content: 'Updated for reindex test',
      });

      // Allow the fire-and-forget reindex to settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTrigger).toHaveBeenCalledWith(workspaceSlug);
    });

    describe.skipIf(!QMD_AVAILABLE)('qmd search round-trip after update', () => {
      beforeEach(() => {
        delete process.env.QMD_SKIP;
      });

      afterEach(() => {
        _resetStoreCache();
        process.env.QMD_SKIP = '1';
      });

      it('should reflect updated content in the DB row after reindex', async () => {
        const uniqueNewToken = 'UpdatedQmdContent67890';

        const created = await caller.memory.create({
          workspaceSlug,
          subtype: 'fact',
          title: 'QMD round-trip fact',
          content: 'OriginalQmdContent12345',
        });

        // Seed the initial index so qmd knows about this file.
        await indexerUpdate(workspaceSlug, 'memory');

        await caller.memory.update({
          id: created.id,
          content: uniqueNewToken,
        });

        // Wait for the fire-and-forget reindex to complete.
        await new Promise((resolve) => setTimeout(resolve, 200));

        // The permanentMemories DB row (updated by syncPermanentMemoryMirror) reflects fresh content.
        const row = ctx.db
          .select({ content: permanentMemories.content })
          .from(permanentMemories)
          .where(eq(permanentMemories.id, created.id))
          .get();
        expect(row?.content).toContain(uniqueNewToken);
      });
    });
  });

  describe('update subtype relocation', () => {
    it('[FR-MEMORY-060] should move file to new subtype dir and update filePath in DB', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Relocatable memory',
        content: 'Content to move.',
      });

      const originalFilePath = created.filePath!;
      expect(originalFilePath).toMatch(/^memory\/facts\//);

      const updated = await caller.memory.update({
        id: created.id,
        subtype: 'decision',
      });

      expect(updated.filePath).toMatch(/^memory\/decisions\//);
      expect(updated.filePath).not.toBe(originalFilePath);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      expect(fs.existsSync(path.join(wsDir, updated.filePath!))).toBe(true);
      expect(fs.existsSync(path.join(wsDir, originalFilePath))).toBe(false);
    });

    it('should keep filePath unchanged when subtype is not modified', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Stable path fact',
        content: 'Content stays.',
      });

      const updated = await caller.memory.update({
        id: created.id,
        title: 'Stable path fact updated',
      });

      expect(updated.filePath).toBe(created.filePath);
    });
  });

  describe('delete', () => {
    it('[FR-MEMORY-090] should remove DB row and delete file', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Deletable fact',
        content: 'To be removed.',
      });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, created.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      await caller.memory.delete({ id: created.id });

      expect(fs.existsSync(absPath)).toBe(false);

      const row = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, created.id))
        .get();
      expect(row).toBeUndefined();
    });

    it('[FR-MEMORY-090] [FR-MEMORY-140] should remove the deleted file from the parent README index', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Fact to delete from README',
        content: 'Content that should vanish from the index.',
      });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const subtypeReadme = path.join(wsDir, 'memory', 'facts', 'README.md');

      // README should reference the file after creation
      expect(fs.existsSync(subtypeReadme)).toBe(true);
      const beforeDelete = fs.readFileSync(subtypeReadme, 'utf8');
      const filename = path.basename(created.filePath!);
      expect(beforeDelete).toContain(filename);

      await caller.memory.delete({ id: created.id });

      // README should no longer reference the deleted file
      const afterDelete = fs.readFileSync(subtypeReadme, 'utf8');
      expect(afterDelete).not.toContain(filename);
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(caller.memory.delete({ id: 99999 })).rejects.toThrow('not found');
    });

    it('[FR-MEMORY-240] should trigger index-on-write after deleting', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Delete trigger fact',
        content: 'To be removed.',
      });

      const mockTrigger = vi.mocked(triggerMemoryIndexOnWrite);
      mockTrigger.mockClear();

      await caller.memory.delete({ id: created.id });

      expect(mockTrigger).toHaveBeenCalledWith(workspaceSlug);
    });
  });

  describe('getByPath', () => {
    it('should return id and kind=permanent for a matching permanent memory', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Path-resolved fact',
        content: 'Resolved by path.',
      });

      const result = await caller.memory.getByPath({
        workspaceSlug,
        filePath: created.filePath!,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.kind).toBe('permanent');
    });

    it('should return null for a path that does not exist', async () => {
      const result = await caller.memory.getByPath({
        workspaceSlug,
        filePath: 'memory/facts/no-such-file.md',
      });

      expect(result).toBeNull();
    });

    it('should throw NOT_FOUND for an unknown workspace', async () => {
      await expect(
        caller.memory.getByPath({
          workspaceSlug: 'no-such-ws',
          filePath: 'memory/facts/any.md',
        }),
      ).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'JWT fact',
        content: 'JWT tokens expire.',
        tags: ['auth', 'jwt'],
        repo: 'api-server',
      });
      await caller.memory.create({
        workspaceSlug,
        subtype: 'decision',
        title: 'Use Redis for caching',
        content: 'Redis was chosen for its speed.',
        tags: ['cache', 'redis'],
        repo: 'api-server',
      });
      await caller.memory.create({
        workspaceSlug,
        subtype: 'pattern',
        title: 'Repository pattern',
        content: 'Repos abstract data access.',
        tags: ['architecture'],
        repo: 'frontend',
      });
    });

    it('should list all memories for a workspace', async () => {
      const result = await caller.memory.list({ workspaceSlug });
      expect(result.length).toBe(3);
    });

    it('should filter by subtype', async () => {
      const result = await caller.memory.list({ workspaceSlug, subtype: 'fact' });
      expect(result.length).toBe(1);
      expect(result[0].subtype).toBe('fact');
    });

    it('should filter by repo', async () => {
      const result = await caller.memory.list({ workspaceSlug, repo: 'api-server' });
      expect(result.length).toBe(2);
    });

    it('should filter by tags (AND match)', async () => {
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth', 'jwt'] });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('JWT fact');
    });

    it('should filter by partial tag match (all tags must be present)', async () => {
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth'] });
      expect(result.length).toBe(1);
    });

    it('should filter by text search on title', async () => {
      const result = await caller.memory.list({ workspaceSlug, search: 'Redis' });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Use Redis for caching');
    });

    it('should filter by text search on content', async () => {
      const result = await caller.memory.list({ workspaceSlug, search: 'Repos abstract' });
      expect(result.length).toBe(1);
      expect(result[0].subtype).toBe('pattern');
    });

    it('should combine subtype and repo filters', async () => {
      const result = await caller.memory.list({
        workspaceSlug,
        subtype: 'decision',
        repo: 'api-server',
      });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Use Redis for caching');
    });

    it('should respect limit and offset', async () => {
      const page1 = await caller.memory.list({ workspaceSlug, limit: 2, offset: 0 });
      const page2 = await caller.memory.list({ workspaceSlug, limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });

    it('should apply tag filter via SQL before pagination so limit is honoured', async () => {
      // 3 items seeded in beforeEach; only 1 has the 'auth' tag.
      // With limit=2 offset=0: should return exactly that 1 match (not 0 due to post-filter trimming).
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth'], limit: 2, offset: 0 });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('JWT fact');
    });

    it('should return correct page when tag filter is combined with offset', async () => {
      // With 1 match for 'auth' and offset=1, result should be empty (not the 1 match)
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth'], limit: 2, offset: 1 });
      expect(result.length).toBe(0);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.list({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });

    it('[FR-MEMORY-080] should exclude memories that have been superseded', async () => {
      const old = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Old superseded fact',
        content: 'This is the old version.',
      });
      const replacement = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'New replacement fact',
        content: 'This is the new version.',
      });

      // Mark old as superseded by replacement
      ctx.db
        .update(permanentMemories)
        .set({ supersededById: replacement.id })
        .where(eq(permanentMemories.id, old.id))
        .run();

      const result = await caller.memory.list({ workspaceSlug });
      const titles = result.map((m) => m.title);
      // The beforeEach seeds 3 memories + we added 2 = 5 total, but old is superseded
      expect(titles).not.toContain('Old superseded fact');
      expect(titles).toContain('New replacement fact');
    });
  });

  describe('graph', () => {
    it('[FR-MEMORY-290] should return nodes for permanent and pending fleeting memories, excluding superseded and non-pending fleeting', async () => {
      const permanent = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Kept fact',
        content: 'A fact that stays around.',
        tags: ['auth'],
        themes: ['security'],
        repo: 'api-server',
      });
      const superseder = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Superseding fact',
        content: 'Replaces the old one.',
      });
      const superseded = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Superseded fact',
        content: 'Old content.',
      });
      ctx.db
        .update(permanentMemories)
        .set({ supersededById: superseder.id })
        .where(eq(permanentMemories.id, superseded.id))
        .run();

      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const pending = ctx.db
        .insert(fleetingMemories)
        .values({ workspaceId: ws.id, content: 'x'.repeat(80), type: 'capture', source: 'agent' })
        .returning()
        .get();
      ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Dismissed candidate',
          type: 'capture',
          source: 'agent',
          dismissedAt: new Date().toISOString(),
        })
        .run();
      ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Promoted candidate',
          type: 'capture',
          source: 'agent',
          promoted: true,
          promotedAt: new Date().toISOString(),
        })
        .run();

      const graph = await caller.memory.graph({ workspaceSlug });
      const nodeIds = graph.nodes.map((n) => n.id);

      expect(nodeIds).toContain(`p:${permanent.id}`);
      expect(nodeIds).toContain(`p:${superseder.id}`);
      expect(nodeIds).not.toContain(`p:${superseded.id}`);
      expect(nodeIds).toContain(`f:${pending.id}`);
      expect(nodeIds.filter((id) => id.startsWith('f:'))).toHaveLength(1);

      const permanentNode = graph.nodes.find((n) => n.id === `p:${permanent.id}`)!;
      expect(permanentNode).toMatchObject({
        kind: 'permanent',
        dbId: permanent.id,
        title: 'Kept fact',
        subtype: 'fact',
        type: null,
        tags: ['auth'],
        themes: ['security'],
        repo: 'api-server',
      });

      const fleetingNode = graph.nodes.find((n) => n.id === `f:${pending.id}`)!;
      expect(fleetingNode).toMatchObject({
        kind: 'fleeting',
        dbId: pending.id,
        subtype: null,
        type: 'capture',
        themes: [],
        repo: null,
      });
      expect(fleetingNode.title).toBe(`${'x'.repeat(60)}…`);
    });

    it('[FR-MEMORY-290] should resolve linkedMemories to links, dedupe bidirectional pairs, and drop dangling paths', async () => {
      const a = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Memory A',
        content: 'Content A',
      });
      const b = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Memory B',
        content: 'Content B',
        linkedMemories: [a.filePath!],
      });
      // Simulate the bidirectional storage auto-linking normally produces.
      await caller.memory.update({ id: a.id, linkedMemories: [b.filePath!] });

      const c = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Memory C',
        content: 'Content C',
        linkedMemories: ['memory/facts/does-not-exist.md'],
      });

      const graph = await caller.memory.graph({ workspaceSlug });

      expect(graph.links).toHaveLength(1);
      const [link] = graph.links;
      expect([link.source, link.target].sort()).toEqual([`p:${a.id}`, `p:${b.id}`].sort());

      const cLinks = graph.links.filter((l) => l.source === `p:${c.id}` || l.target === `p:${c.id}`);
      expect(cLinks).toHaveLength(0);
    });

    it('should not produce a self-loop when linkedMemories contains the memory’s own path', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Self-referencing memory',
        content: 'Content',
      });
      await caller.memory.update({ id: created.id, linkedMemories: [created.filePath!] });

      const graph = await caller.memory.graph({ workspaceSlug });

      expect(graph.links).toHaveLength(0);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.graph({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('promote', () => {
    it('[FR-MEMORY-100] should create a permanent memory from a fleeting memory', async () => {
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: 1,
          content: 'We should always validate inputs server-side.',
          type: 'capture',
          source: 'agent',
          tags: ['validation', 'security'],
        })
        .returning()
        .get();

      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .update(fleetingMemories)
        .set({ workspaceId: ws.id })
        .where(eq(fleetingMemories.id, fleeting.id))
        .run();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'convention',
        title: 'Always validate inputs server-side',
        content: 'Server-side validation is non-negotiable for security.',
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.subtype).toBe('convention');
      expect(result.title).toBe('Always validate inputs server-side');
      expect(result.filePath).toMatch(/^memory\/conventions\//);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, result.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      const updatedFleeting = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleeting.id))
        .get();
      expect(updatedFleeting!.promoted).toBe(true);
      expect(updatedFleeting!.promotedAt).toBeTruthy();
      expect(updatedFleeting!.promotedFromId).toBe(result.id);
    });

    it('should carry fleeting tags forward when not overridden', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Keep original tags',
          type: 'capture',
          source: 'agent',
          tags: ['original', 'fleeting-tag'],
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Promoted with original tags',
      });

      expect(result.tags).toEqual(['original', 'fleeting-tag']);
    });

    it('should use provided content when supplied', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Raw fleeting content',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Refined insight',
        content: 'Refined content for the permanent memory.',
      });

      expect(result.content).toBe('Refined content for the permanent memory.');
    });

    it('should throw NOT_FOUND for non-existent fleeting', async () => {
      await expect(
        caller.memory.promote({
          fleetingMemoryId: 99999,
          subtype: 'fact',
          title: 'X',
        }),
      ).rejects.toThrow('not found');
    });

    it('should inherit fleeting sources when caller supplies none', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Insight from the analysis.',
          type: 'capture',
          source: 'agent',
          sources: ['memory/sources/doc-abc.md', 'memory/sources/doc-xyz.md'],
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Key insight from analysis',
        // no sources supplied — should inherit from fleeting
      });

      expect(result.sources).toEqual(['memory/sources/doc-abc.md', 'memory/sources/doc-xyz.md']);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const raw = fs.readFileSync(path.join(wsDir, result.filePath!), 'utf8');
      expect(raw).toContain('doc-abc.md');
    });

    it('[FR-MEMORY-100] should union caller-supplied and fleeting sources', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Insight from analysis.',
          type: 'capture',
          source: 'agent',
          sources: ['memory/sources/shared.md', 'memory/sources/only-fleeting.md'],
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Unioned sources insight',
        sources: ['memory/sources/shared.md', 'memory/sources/only-caller.md'],
      });

      const sources = result.sources as string[];
      expect(sources).toContain('memory/sources/shared.md');
      expect(sources).toContain('memory/sources/only-fleeting.md');
      expect(sources).toContain('memory/sources/only-caller.md');
      // No duplicates
      const unique = [...new Set(sources)];
      expect(sources.length).toBe(unique.length);
    });

    it('[FR-MEMORY-220] should clear dismissedAt on the fleeting memory when promoting', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Dismissed, then promoted',
          type: 'capture',
          source: 'agent',
          dismissedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Promoted from dismissed',
      });

      const updatedFleeting = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleeting.id))
        .get();
      expect(updatedFleeting!.dismissedAt).toBeNull();
    });

    it('[FR-MEMORY-240] should trigger index-on-write after promoting', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Promote trigger content.',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      const mockTrigger = vi.mocked(triggerMemoryIndexOnWrite);
      mockTrigger.mockClear();

      await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'fact',
        title: 'Promote trigger fact',
      });

      expect(mockTrigger).toHaveBeenCalledWith(workspaceSlug);
    });

    it('[FR-MEMORY-110] should throw BAD_REQUEST when fleeting is already promoted', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Already promoted',
          type: 'capture',
          source: 'agent',
          promoted: true,
        })
        .returning()
        .get();

      await expect(
        caller.memory.promote({
          fleetingMemoryId: fleeting.id,
          subtype: 'fact',
          title: 'Re-promote',
        }),
      ).rejects.toThrow('already been promoted');
    });
  });

  describe('reviewCandidates', () => {
    it('should return only unpromoted, non-dismissed fleeting memories by default', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          {
            workspaceId: ws.id,
            content: 'Unpromoted 1',
            type: 'capture',
            source: 'agent',
            promoted: false,
          },
          {
            workspaceId: ws.id,
            content: 'Unpromoted 2',
            type: 'idea',
            source: 'user',
            promoted: false,
          },
          {
            workspaceId: ws.id,
            content: 'Already promoted',
            type: 'capture',
            source: 'agent',
            promoted: true,
            promotedAt: new Date().toISOString(),
          },
          {
            workspaceId: ws.id,
            content: 'Already dismissed',
            type: 'capture',
            source: 'agent',
            promoted: false,
            dismissedAt: new Date().toISOString(),
          },
        ])
        .run();

      const result = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.items.every((m) => !m.promoted && !m.dismissedAt)).toBe(true);
    });

    it('should return most recent first by default, and oldest first when sort is asc', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          {
            workspaceId: ws.id,
            content: 'Older memory',
            type: 'capture',
            source: 'agent',
            promoted: false,
            createdAt: '2025-01-01T10:00:00.000Z',
          },
          {
            workspaceId: ws.id,
            content: 'Newer memory',
            type: 'capture',
            source: 'agent',
            promoted: false,
            createdAt: '2025-06-01T10:00:00.000Z',
          },
        ])
        .run();

      const desc = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(desc.items[0].content).toBe('Newer memory');
      expect(desc.items[desc.items.length - 1].content).toBe('Older memory');

      const asc = await caller.memory.reviewCandidates({ workspaceSlug, sort: 'asc' });
      expect(asc.items[0].content).toBe('Older memory');
    });

    it('[FR-MEMORY-230] should paginate with limit/offset and return the total before pagination', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const values = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: ws.id,
        content: `Memory ${i}`,
        type: 'capture' as const,
        source: 'agent' as const,
        promoted: false,
      }));
      ctx.db.insert(fleetingMemories).values(values).run();

      const page1 = await caller.memory.reviewCandidates({ workspaceSlug, limit: 5 });
      expect(page1.items.length).toBe(5);
      expect(page1.total).toBe(10);

      const page2 = await caller.memory.reviewCandidates({ workspaceSlug, limit: 5, offset: 5 });
      expect(page2.items.length).toBe(5);
      expect(page2.total).toBe(10);
    });

    it('[FR-MEMORY-230] should filter by status=dismissed, type, search, and tag', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          {
            workspaceId: ws.id,
            content: 'Pending capture about auth',
            type: 'capture',
            source: 'agent',
            promoted: false,
            tags: ['auth'],
          },
          {
            workspaceId: ws.id,
            content: 'Pending idea about billing',
            type: 'idea',
            source: 'agent',
            promoted: false,
            tags: ['billing'],
          },
          {
            workspaceId: ws.id,
            content: 'Dismissed note about auth',
            type: 'capture',
            source: 'agent',
            promoted: false,
            tags: ['auth'],
            dismissedAt: new Date().toISOString(),
          },
        ])
        .run();

      const dismissed = await caller.memory.reviewCandidates({ workspaceSlug, status: 'dismissed' });
      expect(dismissed.items.length).toBe(1);
      expect(dismissed.items[0].content).toBe('Dismissed note about auth');

      const byType = await caller.memory.reviewCandidates({ workspaceSlug, type: 'idea' });
      expect(byType.items.length).toBe(1);
      expect(byType.items[0].content).toBe('Pending idea about billing');

      const bySearch = await caller.memory.reviewCandidates({ workspaceSlug, search: 'billing' });
      expect(bySearch.items.length).toBe(1);

      const byTag = await caller.memory.reviewCandidates({ workspaceSlug, tag: 'auth' });
      expect(byTag.items.length).toBe(1);
      expect(byTag.items[0].content).toBe('Pending capture about auth');
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.reviewCandidates({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });

    it('should return an empty page when no fleeting memories exist', async () => {
      const result = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('reviewCandidateClusters', () => {
    it('[FR-MEMORY-280] should return one singleton cluster per pending memory under QMD_SKIP=1', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          { workspaceId: ws.id, content: 'Pending A', type: 'capture', source: 'agent' },
          { workspaceId: ws.id, content: 'Pending B', type: 'capture', source: 'agent' },
          {
            workspaceId: ws.id,
            content: 'Dismissed candidate',
            type: 'capture',
            source: 'agent',
            dismissedAt: new Date().toISOString(),
          },
          {
            workspaceId: ws.id,
            content: 'Promoted candidate',
            type: 'capture',
            source: 'agent',
            promoted: true,
            promotedAt: new Date().toISOString(),
          },
        ])
        .run();

      const result = await caller.memory.reviewCandidateClusters({ workspaceSlug });

      expect(result.truncated).toBe(false);
      expect(result.clusters).toHaveLength(2);
      expect(result.clusters.every((cl) => cl.memberCount === 1 && cl.ids.length === 1)).toBe(true);
      const contents = result.clusters.map((cl) => cl.members[0].content).sort();
      expect(contents).toEqual(['Pending A', 'Pending B']);
      // QMD_SKIP=1 in tests, so these singletons come from a degraded pass
      // rather than a queue that genuinely holds no near-duplicates.
      expect(result.degraded).toBe(true);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.reviewCandidateClusters({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });

    it('should return no clusters when there are no pending fleeting memories', async () => {
      const result = await caller.memory.reviewCandidateClusters({ workspaceSlug });
      expect(result).toEqual({ clusters: [], truncated: false, degraded: false });
    });
  });

  describe('dismissFleeting', () => {
    it('[FR-MEMORY-190] should set dismissedAt and exclude the memory from default review candidates', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({ workspaceId: ws.id, content: 'Dismiss me', type: 'capture', source: 'agent' })
        .returning()
        .get();

      const result = await caller.memory.dismissFleeting({ workspaceSlug, id: fleeting.id });
      expect(result.dismissedAt).toBeTruthy();

      const candidates = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(candidates.items.find((m) => m.id === fleeting.id)).toBeUndefined();
    });

    it('[FR-MEMORY-190] should reject dismissing an already-promoted memory', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Promoted already',
          type: 'capture',
          source: 'agent',
          promoted: true,
          promotedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      await expect(
        caller.memory.dismissFleeting({ workspaceSlug, id: fleeting.id }),
      ).rejects.toThrow('already been promoted');
    });

    it('should throw NOT_FOUND for a non-existent id', async () => {
      await expect(
        caller.memory.dismissFleeting({ workspaceSlug, id: 99999 }),
      ).rejects.toThrow('not found');
    });
  });

  describe('restoreFleeting', () => {
    it('[FR-MEMORY-200] should null dismissedAt and bring the memory back into default review candidates', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Restore me',
          type: 'capture',
          source: 'agent',
          dismissedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      const result = await caller.memory.restoreFleeting({ workspaceSlug, id: fleeting.id });
      expect(result.dismissedAt).toBeNull();

      const candidates = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(candidates.items.find((m) => m.id === fleeting.id)).toBeDefined();
    });

    it('should throw NOT_FOUND for a non-existent id', async () => {
      await expect(
        caller.memory.restoreFleeting({ workspaceSlug, id: 99999 }),
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteFleeting', () => {
    it('[FR-MEMORY-210] should hard-delete an unpromoted fleeting memory', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({ workspaceId: ws.id, content: 'Delete me', type: 'capture', source: 'agent' })
        .returning()
        .get();

      const result = await caller.memory.deleteFleeting({ workspaceSlug, id: fleeting.id });
      expect(result.success).toBe(true);

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleeting.id))
        .get();
      expect(row).toBeUndefined();
    });

    it('[FR-MEMORY-210] should reject deleting an already-promoted memory, leaving it intact', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Promoted, protected',
          type: 'capture',
          source: 'agent',
          promoted: true,
          promotedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      await expect(
        caller.memory.deleteFleeting({ workspaceSlug, id: fleeting.id }),
      ).rejects.toThrow('already been promoted');

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleeting.id))
        .get();
      expect(row).toBeDefined();
    });

    it('should throw NOT_FOUND for a non-existent id', async () => {
      await expect(
        caller.memory.deleteFleeting({ workspaceSlug, id: 99999 }),
      ).rejects.toThrow('not found');
    });
  });

  describe('createFleeting', () => {
    it('[FR-MEMORY-010] should create a fleeting memory and return its id', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'Remember to refactor the auth module',
      });

      expect(result.id).toBeGreaterThan(0);

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.content).toBe('Remember to refactor the auth module');
      expect(row?.source).toBe('user');
      expect(row?.type).toBe('capture');
      expect(row?.promoted).toBe(false);
    });

    it('should store supplied tags', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'Tagged capture',
        tags: ['auth', 'refactor'],
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.tags).toEqual(['auth', 'refactor']);
    });

    it('should respect an explicit source value', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'Agent-sourced capture',
        source: 'agent',
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.source).toBe('agent');
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.createFleeting({
          workspaceSlug: 'no-such-ws',
          content: 'Some thought',
        }),
      ).rejects.toThrow('not found');
    });

    it('should default type to capture when not provided', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'Untyped capture',
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.type).toBe('capture');
    });

    it('should store an explicit type', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'An open question',
        type: 'question',
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.type).toBe('question');
    });

    it('should store supplied sources', async () => {
      const sources = ['memory/sources/ref-a.md', 'memory/references/ref-b.md'];
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'Distilled from sources',
        sources,
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.sources).toEqual(sources);
    });

    it('should default sources to empty array when not provided', async () => {
      const result = await caller.memory.createFleeting({
        workspaceSlug,
        content: 'No sources',
      });

      const row = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, result.id))
        .get();
      expect(row?.sources).toEqual([]);
    });

    it('[FR-MEMORY-020] should reject empty content', async () => {
      await expect(
        caller.memory.createFleeting({
          workspaceSlug,
          content: '',
        }),
      ).rejects.toThrow();
    });
  });

  describe('proposePromotion', () => {
    it('should throw NOT_FOUND for a non-existent fleeting memory', async () => {
      await expect(
        caller.memory.proposePromotion({ fleetingMemoryId: 99999 }),
      ).rejects.toThrow('not found');
    });

    it('[FR-MEMORY-170] should return null when LLM is unavailable (QMD_SKIP=1)', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'We chose SQLite over PostgreSQL for simplicity in single-user mode.',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      // The vi.mock at the top makes proposeMemoryMetadata return null (QMD_SKIP simulation).
      const result = await caller.memory.proposePromotion({ fleetingMemoryId: fleeting.id });
      expect(result).toBeNull();
    });

    it('[FR-MEMORY-160] should return a proposal when the LLM responds', async () => {
      const { proposeMemoryMetadata } = await import('../../lib/promote-proposal');
      const mockPropose = vi.mocked(proposeMemoryMetadata);
      mockPropose.mockResolvedValueOnce({
        title: 'SQLite chosen for single-user simplicity',
        subtype: 'decision',
        keywords: ['sqlite', 'postgresql', 'database'],
        themes: ['persistence', 'infrastructure'],
        tags: ['architecture'],
        confidence: 0.9,
        rationale: 'Describes a technology choice with explicit reasoning.',
        linkedMemories: [],
      });

      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'We chose SQLite over PostgreSQL for simplicity in single-user mode.',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      const result = await caller.memory.proposePromotion({ fleetingMemoryId: fleeting.id });

      expect(result).not.toBeNull();
      expect(result?.title).toBe('SQLite chosen for single-user simplicity');
      expect(result?.subtype).toBe('decision');
      expect(result?.keywords).toContain('sqlite');
      expect(result?.confidence).toBe(0.9);
    });
  });
});
