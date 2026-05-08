/**
 * Search router tests — trophy-style BDD, no DB mocks.
 *
 * Uses setupTestDb() for a fresh SQLite DB per test. The frontmatter table
 * is populated directly for filter-only and combined tests (avoids needing
 * qmd indexer to run). qmd-dependent (hybrid search) assertions are gated
 * behind describe.skipIf(!QMD_AVAILABLE).
 *
 * QMD_SKIP=1 is set for non-qmd tests so the router skips getStore() init,
 * keeping tests fast. Tests under describe.skipIf(!QMD_AVAILABLE) unset it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { frontmatter, tasks, projects } from '../../db/schema';
import { _resetStoreCache } from '../../search/qmd-store';
import { update } from '../../search/indexer';

// qmd hybrid search requires a local GGUF model.
// Hash indexing and frontmatter sync run offline.
const QMD_AVAILABLE = process.env.QMD_AVAILABLE === '1';

// Skip qmd store initialization in most tests to avoid model download delays.
// Tests that need qmd will clear this flag inside their beforeEach.
process.env.QMD_SKIP = '1';

/** Insert a frontmatter row directly into the given db, bypassing the indexer. */
function insertFrontmatterRow(
  db: TestContext['db'],
  workspaceId: number,
  collection: 'system' | 'docs' | 'projects' | 'memory',
  filePath: string,
  data: Record<string, unknown> | string,
): void {
  const dataJson = typeof data === 'string' ? data : JSON.stringify(data);
  db.insert(frontmatter)
    .values({
      workspaceId,
      collection,
      path: filePath,
      data: dataJson,
      indexedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [frontmatter.workspaceId, frontmatter.path],
      set: {
        collection,
        data: dataJson,
        indexedAt: new Date().toISOString(),
      },
    })
    .run();
}

describe('search router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceSlug: string;
  let workspaceId: number;
  let wsDir: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Search Test WS' });
    workspaceSlug = ws.slug;
    workspaceId = ws.id;
    wsDir = path.join(ctx.tmpDir, workspaceSlug);
  });

  afterEach(() => {
    _resetStoreCache();
    ctx.cleanup();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function writeFile(relPath: string, content: string): void {
    const abs = path.join(wsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  /**
   * Insert a frontmatter row directly, bypassing the indexer.
   * The indexer tests cover the indexer; here we test the search queries.
   */
  function insertFrontmatter(
    collection: 'system' | 'docs' | 'projects' | 'memory',
    filePath: string,
    data: Record<string, unknown> | string,
  ): void {
    insertFrontmatterRow(ctx.db, workspaceId, collection, filePath, data);
  }

  async function insertTaskInWorkspace(title: string, description?: string, status = 'todo') {
    const proj = await caller.project.create({ workspaceSlug, name: 'Search Project' });
    const created = await caller.task.create({
      projectId: proj.id,
      title,
      description,
    });
    const task =
      status !== 'todo'
        ? await caller.task.update({
            id: created.id,
            status: status as 'backlog' | 'todo' | 'in_progress' | 'review' | 'done',
          })
        : created;
    return { proj, task };
  }

  // ── not found ─────────────────────────────────────────────────────────

  describe('workspace resolution', () => {
    it('should throw NOT_FOUND for unknown workspace slug', async () => {
      await expect(
        caller.search.query({ workspaceSlug: 'no-such-ws', query: 'test' }),
      ).rejects.toThrow('not found');
    });
  });

  // ── empty / no-op ─────────────────────────────────────────────────────

  describe('no query or filters', () => {
    it('should return empty array when neither query nor filters are provided', async () => {
      const result = await caller.search.query({ workspaceSlug });
      expect(result).toEqual([]);
    });
  });

  // ── Mode 2: filters only — SQLite JSON1 ──────────────────────────────

  describe('filters-only mode', () => {
    describe('scalar filter: type', () => {
      it('should return rows matching type scalar field', async () => {
        insertFrontmatter('system', 'system/overview.md', {
          title: 'System Overview',
          type: 'architecture',
        });
        insertFrontmatter('system', 'system/runbook.md', {
          title: 'Runbook',
          type: 'runbook',
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { type: 'architecture' },
        });

        const sysGroup = result.find((g) => g.collection === 'system');
        expect(sysGroup).toBeDefined();
        expect(sysGroup!.results).toHaveLength(1);
        expect(sysGroup!.results[0].path).toBe('system/overview.md');
      });
    });

    describe('scalar filter: subtype', () => {
      it('should return rows matching subtype scalar field', async () => {
        insertFrontmatter('memory', 'memory/decisions/001-test.md', {
          title: 'Use TypeScript',
          subtype: 'decision',
        });
        insertFrontmatter('memory', 'memory/facts/002-test.md', {
          title: 'SQLite is embedded',
          subtype: 'fact',
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { subtype: 'decision' },
        });

        const memGroup = result.find((g) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        expect(memGroup!.results).toHaveLength(1);
        expect(memGroup!.results[0].path).toBe('memory/decisions/001-test.md');
        expect(memGroup!.results[0].title).toBe('Use TypeScript');
      });
    });

    describe('scalar filter: repo', () => {
      it('should return only rows with matching repo field', async () => {
        insertFrontmatter('memory', 'memory/decisions/repo-a.md', {
          title: 'API decision',
          repo: 'api-server',
        });
        insertFrontmatter('memory', 'memory/facts/unrelated.md', {
          title: 'Frontend fact',
          repo: 'web-app',
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { repo: 'api-server' },
        });

        const memGroup = result.find((g) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        const paths = memGroup!.results.map((r) => r.path);
        expect(paths).toContain('memory/decisions/repo-a.md');
        expect(paths).not.toContain('memory/facts/unrelated.md');
      });
    });

    describe('array filter: tags membership', () => {
      it('should return rows where tags array includes the requested tag', async () => {
        insertFrontmatter('docs', 'docs/auth-guide.md', {
          title: 'Auth Guide',
          tags: ['auth', 'jwt'],
        });
        insertFrontmatter('docs', 'docs/unrelated.md', {
          title: 'Unrelated Doc',
          tags: ['deployment'],
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { tags: ['auth'] },
        });

        const docsGroup = result.find((g) => g.collection === 'docs');
        expect(docsGroup).toBeDefined();
        const paths = docsGroup!.results.map((r) => r.path);
        expect(paths).toContain('docs/auth-guide.md');
        expect(paths).not.toContain('docs/unrelated.md');
      });

      it('should AND multiple tag values together', async () => {
        insertFrontmatter('docs', 'docs/both-tags.md', {
          title: 'Both Tags',
          tags: ['auth', 'security'],
        });
        insertFrontmatter('docs', 'docs/one-tag.md', {
          title: 'One Tag Only',
          tags: ['auth'],
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { tags: ['auth', 'security'] },
        });

        const docsGroup = result.find((g) => g.collection === 'docs');
        const paths = docsGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain('docs/both-tags.md');
        expect(paths).not.toContain('docs/one-tag.md');
      });
    });

    describe('array filter: linkedMemories membership', () => {
      it('should return rows where linkedMemories includes the requested id', async () => {
        insertFrontmatter('memory', 'memory/decisions/linked.md', {
          title: 'Linked Decision',
          linkedMemories: ['memory/facts/fact-001.md', 'memory/patterns/pat-001.md'],
        });
        insertFrontmatter('memory', 'memory/facts/standalone.md', {
          title: 'Standalone Fact',
          linkedMemories: [],
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { linkedMemories: ['memory/facts/fact-001.md'] },
        });

        const memGroup = result.find((g) => g.collection === 'memory');
        expect(memGroup).toBeDefined();
        const paths = memGroup!.results.map((r) => r.path);
        expect(paths).toContain('memory/decisions/linked.md');
        expect(paths).not.toContain('memory/facts/standalone.md');
      });
    });

    describe('mixed scalar + array filters AND together', () => {
      it('should require all filter conditions to match', async () => {
        insertFrontmatter('memory', 'memory/decisions/match-all.md', {
          title: 'Match All Filters',
          subtype: 'decision',
          repo: 'api-server',
          tags: ['important'],
        });
        insertFrontmatter('memory', 'memory/facts/partial-match.md', {
          title: 'Partial Match',
          subtype: 'fact',
          repo: 'api-server',
          tags: ['important'],
        });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { subtype: 'decision', repo: 'api-server', tags: ['important'] },
        });

        const memGroup = result.find((g) => g.collection === 'memory');
        const paths = memGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain('memory/decisions/match-all.md');
        expect(paths).not.toContain('memory/facts/partial-match.md');
      });
    });

    describe('collection scoping', () => {
      it('should only return results from the specified collection', async () => {
        insertFrontmatter('docs', 'docs/a-doc.md', { title: 'A Doc', tags: ['shared'] });
        insertFrontmatter('system', 'system/a-sys.md', { title: 'A Sys', tags: ['shared'] });

        const result = await caller.search.query({
          workspaceSlug,
          collection: 'docs',
          filters: { tags: ['shared'] },
        });

        const collections = result.map((g) => g.collection);
        expect(collections).toContain('docs');
        expect(collections).not.toContain('system');
      });
    });

    describe('cross-collection grouping', () => {
      it('should return results grouped by collection', async () => {
        insertFrontmatter('system', 'system/arch.md', { title: 'Architecture', tags: ['core'] });
        insertFrontmatter('docs', 'docs/guide.md', { title: 'Guide', tags: ['core'] });
        insertFrontmatter('projects', 'projects/plan.md', { title: 'Plan', tags: ['core'] });
        insertFrontmatter('memory', 'memory/decisions/d1.md', { title: 'D1', tags: ['core'] });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { tags: ['core'] },
        });

        const collectionNames = result.map((g) => g.collection).sort();
        expect(collectionNames).toEqual(
          expect.arrayContaining(['system', 'docs', 'projects', 'memory']),
        );

        for (const group of result) {
          expect(group.results.length).toBeGreaterThan(0);
          for (const item of group.results) {
            expect(item.path).toBeTruthy();
            expect(item.title).toBeTruthy();
          }
        }
      });
    });

    describe('tasks: status filter', () => {
      it('should return tasks matching the status filter', async () => {
        const { task } = await insertTaskInWorkspace(
          'Complete auth flow',
          'Implement OAuth2',
          'done',
        );

        const result = await caller.search.query({
          workspaceSlug,
          filters: { status: 'done' },
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        const paths = taskGroup!.results.map((r) => r.path);
        expect(paths).toContain(`task:${task.id}`);
      });

      it('should not return tasks of a different status', async () => {
        await insertTaskInWorkspace('In progress task', undefined, 'in_progress');

        const result = await caller.search.query({
          workspaceSlug,
          filters: { status: 'done' },
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        expect(taskGroup?.results ?? []).toHaveLength(0);
      });

      it('should scope task status filter to workspace', async () => {
        // Create a second workspace with a task that should not appear
        const ws2 = await caller.workspace.create({ name: 'Other WS' });
        const proj2 = await caller.project.create({ workspaceSlug: ws2.slug, name: 'Other Proj' });
        const createdOtherTask = await caller.task.create({
          projectId: proj2.id,
          title: 'Other task',
        });
        const otherTask = await caller.task.update({ id: createdOtherTask.id, status: 'done' });

        const { task: myTask } = await insertTaskInWorkspace('My done task', undefined, 'done');

        const result = await caller.search.query({
          workspaceSlug,
          filters: { status: 'done' },
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        const paths = taskGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain(`task:${myTask.id}`);
        expect(paths).not.toContain(`task:${otherTask.id}`);
      });
    });

    describe('title extraction', () => {
      it('should fall back to path-derived title when frontmatter data is invalid JSON', async () => {
        // Insert a row with deliberately broken JSON to exercise the catch branch in extractTitle.
        // The status-only filter runs a frontmatter query with no JSON1 conditions, so the broken
        // row passes through and extractTitle must silently handle the parse failure.
        insertFrontmatter('docs', 'docs/broken-json.md', 'NOT_VALID_JSON');

        // status-only filter → frontmatter query returns ALL rows (no JSON1 condition on data)
        const result = await caller.search.query({
          workspaceSlug,
          filters: { status: 'done' },
        });

        // Should not throw; broken row gets a path-derived title
        const docsGroup = result.find((g) => g.collection === 'docs');
        const item = docsGroup?.results.find((r) => r.path === 'docs/broken-json.md');
        expect(item).toBeDefined();
        expect(item!.title).toBe('broken json');
      });

      it('should extract title from frontmatter data JSON', async () => {
        insertFrontmatter('docs', 'docs/titled.md', { title: 'My Titled Doc', tags: ['test'] });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { tags: ['test'] },
        });

        const docsGroup = result.find((g) => g.collection === 'docs');
        const item = docsGroup?.results.find((r) => r.path === 'docs/titled.md');
        expect(item?.title).toBe('My Titled Doc');
      });

      it('should fall back to path-derived title when no title in frontmatter', async () => {
        insertFrontmatter('docs', 'docs/my-great-guide.md', { tags: ['test'] });

        const result = await caller.search.query({
          workspaceSlug,
          filters: { tags: ['test'] },
        });

        const docsGroup = result.find((g) => g.collection === 'docs');
        const item = docsGroup?.results.find((r) => r.path === 'docs/my-great-guide.md');
        expect(item?.title).toBe('my great guide');
      });
    });
  });

  // ── Mode 1: query only — qmd hybrid + task LIKE ──────────────────────

  describe('query-only mode', () => {
    describe('task full-text search (always runs — no model needed)', () => {
      it('should find tasks matching the query in title via LIKE', async () => {
        const { task } = await insertTaskInWorkspace(
          'Implement authentication service',
          'Build JWT-based auth',
        );

        // Insert a non-matching task too
        await insertTaskInWorkspace('Unrelated task', 'Nothing to do with auth');

        const result = await caller.search.query({
          workspaceSlug,
          query: 'authentication',
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        expect(taskGroup).toBeDefined();
        const paths = taskGroup!.results.map((r) => r.path);
        expect(paths).toContain(`task:${task.id}`);
      });

      it('should find tasks matching the query in description', async () => {
        const { task } = await insertTaskInWorkspace(
          'Generic task title',
          'Contains JWT token implementation details',
        );

        const result = await caller.search.query({
          workspaceSlug,
          query: 'JWT token',
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        const paths = taskGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain(`task:${task.id}`);
      });

      it('should include snippet from description when available', async () => {
        const { task } = await insertTaskInWorkspace(
          'Task with description',
          'This description contains important context about the work',
        );

        const result = await caller.search.query({ workspaceSlug, query: 'important context' });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        const item = taskGroup?.results.find((r) => r.path === `task:${task.id}`);
        expect(item?.snippet).toBeTruthy();
      });

      it('should scope task search to the current workspace', async () => {
        const ws2 = await caller.workspace.create({ name: 'WS2' });
        const proj2 = await caller.project.create({ workspaceSlug: ws2.slug, name: 'P2' });
        await caller.task.create({
          projectId: proj2.id,
          title: 'Other workspace auth task',
        });

        const { task: myTask } = await insertTaskInWorkspace('My auth task');

        const result = await caller.search.query({ workspaceSlug, query: 'auth task' });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        const paths = taskGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain(`task:${myTask.id}`);
        // Other workspace task should not appear
        const otherTasks = ctx.db
          .select({ id: tasks.id })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(eq(projects.workspaceId, ws2.id))
          .all();
        for (const ot of otherTasks) {
          expect(paths).not.toContain(`task:${ot.id}`);
        }
      });

      it('should return empty task group when nothing matches', async () => {
        await insertTaskInWorkspace('Task about dogs');

        const result = await caller.search.query({ workspaceSlug, query: 'xyzzy_no_match_here' });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        expect(taskGroup?.results ?? []).toHaveLength(0);
      });
    });

    describe.skipIf(!QMD_AVAILABLE)('qmd hybrid search', () => {
      beforeEach(() => {
        delete process.env.QMD_SKIP;
      });
      afterEach(() => {
        process.env.QMD_SKIP = '1';
      });

      it('should return grouped results by collection from qmd', async () => {
        writeFile('docs/auth-guide.md', '---\ntitle: Auth Guide\n---\n\nJWT authentication flow.\n');
        await update(workspaceSlug, 'docs');

        const result = await caller.search.query({ workspaceSlug, query: 'authentication' });

        const collectionNames = result.map((g) => g.collection);
        expect(collectionNames).toContain('docs');
      });

      it('should include path and score in results', async () => {
        writeFile('docs/auth.md', '---\ntitle: Auth\n---\n\nAuth content.\n');
        await update(workspaceSlug, 'docs');

        const result = await caller.search.query({ workspaceSlug, query: 'auth content' });

        const docsGroup = result.find((g) => g.collection === 'docs');
        if (docsGroup && docsGroup.results.length > 0) {
          expect(docsGroup.results[0].path).toBeTruthy();
          expect(docsGroup.results[0].score).toBeTypeOf('number');
        }
      });
    });
  });

  // ── Mode 3: query + filters ───────────────────────────────────────────

  describe('query + filters mode', () => {
    describe('task results with status filter', () => {
      it('should include task status filter alongside query', async () => {
        const { task: doneTask } = await insertTaskInWorkspace(
          'Done auth task',
          'Finished auth work',
          'done',
        );
        const { task: todoTask } = await insertTaskInWorkspace(
          'Todo auth task',
          'Auth work remaining',
          'todo',
        );

        const result = await caller.search.query({
          workspaceSlug,
          query: 'auth',
          filters: { status: 'done' },
        });

        const taskGroup = result.find((g) => g.collection === 'tasks');
        const paths = taskGroup?.results.map((r) => r.path) ?? [];
        expect(paths).toContain(`task:${doneTask.id}`);
        expect(paths).not.toContain(`task:${todoTask.id}`);
      });
    });

    describe.skipIf(!QMD_AVAILABLE)('qmd + frontmatter narrowing', () => {
      beforeEach(() => {
        delete process.env.QMD_SKIP;
      });
      afterEach(() => {
        process.env.QMD_SKIP = '1';
      });

      it('should narrow qmd results by frontmatter filter', async () => {
        writeFile(
          'docs/auth-jwt.md',
          '---\ntitle: Auth JWT\ntags: [auth]\n---\n\nJWT authentication flow.\n',
        );
        writeFile(
          'docs/auth-oauth.md',
          '---\ntitle: Auth OAuth\ntags: [oauth]\n---\n\nOAuth authentication flow.\n',
        );
        await update(workspaceSlug, 'docs');

        const result = await caller.search.query({
          workspaceSlug,
          query: 'authentication',
          filters: { tags: ['auth'] },
        });

        const docsGroup = result.find((g) => g.collection === 'docs');
        if (docsGroup && docsGroup.results.length > 0) {
          const paths = docsGroup.results.map((r) => r.path);
          expect(paths.every((p) => !p.includes('oauth'))).toBe(true);
        }
      });
    });
  });
});

// ── Mocked qmd store tests — cover qmd code paths without a real model ──────

import * as qmdStoreModule from '../../search/qmd-store';

describe('search router — mocked qmd store', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceSlug: string;
  let workspaceId: number;
  // Inferred as MockInstance<(workspaceSlug: string) => Promise<QMDStore>>
  let getStoreSpy: ReturnType<typeof vi.spyOn<typeof qmdStoreModule, never>>;

  beforeEach(async () => {
    // Enable qmd code paths — spy provides the store
    delete process.env.QMD_SKIP;

    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Mock QMD WS' });
    workspaceSlug = ws.slug;
    workspaceId = ws.id;

    getStoreSpy = vi.spyOn(qmdStoreModule, 'getStore');
  });

  afterEach(() => {
    process.env.QMD_SKIP = '1';
    _resetStoreCache();
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function insertFrontmatter(
    collection: 'system' | 'docs' | 'projects' | 'memory',
    filePath: string,
    data: Record<string, unknown>,
  ): void {
    insertFrontmatterRow(ctx.db, workspaceId, collection, filePath, data);
  }

  function mockSearchResults(
    hits: Array<{
      file: string;
      displayPath: string;
      title: string;
      bestChunk: string;
      score: number;
    }>,
  ) {
    getStoreSpy.mockResolvedValue({
      search: vi.fn().mockResolvedValue(hits),
    } as unknown as Awaited<ReturnType<typeof qmdStoreModule.getStore>>);
  }

  describe('query-only mode with mocked qmd', () => {
    it('should group qmd results by collection derived from virtual path', async () => {
      mockSearchResults([
        {
          file: 'qmd://docs/auth-guide.md',
          displayPath: 'auth-guide.md',
          title: 'Auth Guide',
          bestChunk: 'JWT authentication is used.',
          score: 0.9,
        },
        {
          file: 'qmd://memory/decisions/001.md',
          displayPath: 'decisions/001.md',
          title: 'Auth Decision',
          bestChunk: 'We chose JWT.',
          score: 0.8,
        },
      ]);

      const result = await caller.search.query({ workspaceSlug, query: 'authentication' });

      const docsGroup = result.find((g) => g.collection === 'docs');
      const memoryGroup = result.find((g) => g.collection === 'memory');
      expect(docsGroup).toBeDefined();
      expect(memoryGroup).toBeDefined();
      expect(docsGroup!.results[0].path).toBe('docs/auth-guide.md');
      expect(docsGroup!.results[0].score).toBe(0.9);
      expect(docsGroup!.results[0].snippet).toContain('JWT authentication');
      expect(memoryGroup!.results[0].path).toBe('memory/decisions/001.md');
    });

    it('should surface PRECONDITION_FAILED when model is downloading', async () => {
      getStoreSpy.mockRejectedValue(new Error('Downloading model weights...'));

      await expect(
        caller.search.query({ workspaceSlug, query: 'test' }),
      ).rejects.toThrow('Embedding model is not yet available');
    });

    it('should propagate non-model errors from qmd', async () => {
      getStoreSpy.mockRejectedValue(new Error('Database corruption detected'));

      await expect(
        caller.search.query({ workspaceSlug, query: 'test' }),
      ).rejects.toThrow('Database corruption detected');
    });

    it('should fall back to path-derived title when qmd hit has no title', async () => {
      mockSearchResults([
        {
          file: 'qmd://docs/my-doc.md',
          displayPath: 'my-doc.md',
          title: '',
          bestChunk: 'Some content.',
          score: 0.7,
        },
      ]);

      const result = await caller.search.query({ workspaceSlug, query: 'content' });

      const docsGroup = result.find((g) => g.collection === 'docs');
      expect(docsGroup!.results[0].title).toBe('my doc');
    });
  });

  describe('query + filters mode with mocked qmd', () => {
    it('should narrow qmd results by frontmatter filter', async () => {
      insertFrontmatter('docs', 'docs/auth-jwt.md', { title: 'Auth JWT', tags: ['auth'] });
      insertFrontmatter('docs', 'docs/auth-oauth.md', { title: 'Auth OAuth', tags: ['oauth'] });

      mockSearchResults([
        {
          file: 'qmd://docs/auth-jwt.md',
          displayPath: 'auth-jwt.md',
          title: 'Auth JWT',
          bestChunk: 'JWT auth.',
          score: 0.95,
        },
        {
          file: 'qmd://docs/auth-oauth.md',
          displayPath: 'auth-oauth.md',
          title: 'Auth OAuth',
          bestChunk: 'OAuth auth.',
          score: 0.85,
        },
      ]);

      const result = await caller.search.query({
        workspaceSlug,
        query: 'authentication',
        filters: { tags: ['auth'] },
      });

      const docsGroup = result.find((g) => g.collection === 'docs');
      expect(docsGroup).toBeDefined();
      const paths = docsGroup!.results.map((r) => r.path);
      expect(paths).toContain('docs/auth-jwt.md');
      expect(paths).not.toContain('docs/auth-oauth.md');
    });

    it('should return empty file groups when qmd has no results', async () => {
      mockSearchResults([]);

      const result = await caller.search.query({
        workspaceSlug,
        query: 'obscure',
        filters: { tags: ['auth'] },
      });

      const fileGroups = result.filter((g) => g.collection !== 'tasks');
      expect(fileGroups).toHaveLength(0);
    });

    it('should surface PRECONDITION_FAILED on model download in query+filter mode', async () => {
      getStoreSpy.mockRejectedValue(new Error('model download in progress'));

      await expect(
        caller.search.query({
          workspaceSlug,
          query: 'test',
          filters: { subtype: 'decision' },
        }),
      ).rejects.toThrow('Embedding model is not yet available');
    });

    it('should propagate non-model errors from qmd in query+filter mode', async () => {
      getStoreSpy.mockRejectedValue(new Error('Disk I/O failure'));

      await expect(
        caller.search.query({
          workspaceSlug,
          query: 'test',
          filters: { subtype: 'decision' },
        }),
      ).rejects.toThrow('Disk I/O failure');
    });

    it('should sort results by score descending within each collection group', async () => {
      insertFrontmatter('memory', 'memory/decisions/a.md', { title: 'A', tags: ['x'] });
      insertFrontmatter('memory', 'memory/decisions/b.md', { title: 'B', tags: ['x'] });

      mockSearchResults([
        {
          file: 'qmd://memory/decisions/b.md',
          displayPath: 'decisions/b.md',
          title: 'B',
          bestChunk: 'B content.',
          score: 0.9,
        },
        {
          file: 'qmd://memory/decisions/a.md',
          displayPath: 'decisions/a.md',
          title: 'A',
          bestChunk: 'A content.',
          score: 0.6,
        },
      ]);

      const result = await caller.search.query({
        workspaceSlug,
        query: 'query',
        filters: { tags: ['x'] },
      });

      const memGroup = result.find((g) => g.collection === 'memory');
      expect(memGroup).toBeDefined();
      expect(memGroup!.results[0].path).toBe('memory/decisions/b.md');
      expect(memGroup!.results[1].path).toBe('memory/decisions/a.md');
    });
  });
});
