/**
 * qmd-search tests — trophy-style BDD, real qmd store. Lex-mode search runs
 * on SQLite FTS5 only (no embeddings/model download needed), so these run
 * offline. See indexer.test.ts for the QMD_AVAILABLE gating convention used
 * when a test needs actual vector embeddings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { appRouter } from '../trpc/root';
import { update } from './indexer';
import { getStore, _resetStoreCache } from './qmd-store';
import { runQmdSearch, isReadme } from './qmd-search';

describe('qmd-search', () => {
  let ctx: TestContext;
  let workspaceSlug: string;
  let wsDir: string;
  let workspace: { slug: string; docsDir: string | null };

  beforeEach(async () => {
    ctx = setupTestDb();
    const caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Search Test WS' });
    workspaceSlug = ws.slug;
    wsDir = path.join(ctx.tmpDir, workspaceSlug);
    workspace = { slug: workspaceSlug, docsDir: null };
  });

  afterEach(() => {
    _resetStoreCache();
    ctx.cleanup();
  });

  function writeFixture(relPath: string, content: string): void {
    const abs = path.join(wsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  describe('isReadme', () => {
    it('should identify README.md case-insensitively', () => {
      expect(isReadme('docs/README.md')).toBe(true);
      expect(isReadme('docs/readme.md')).toBe(true);
      expect(isReadme('docs/guide.md')).toBe(false);
    });
  });

  describe('runQmdSearch — snippet', () => {
    it('[FR-SEARCH-016] should never include YAML frontmatter in the snippet', async () => {
      writeFixture(
        'docs/terminal-reconnect.md',
        [
          '---',
          'title: Terminal Reconnect Guide',
          'tags: [terminal, reconnect]',
          '---',
          '',
          'The client automatically retries the underlying socket connection',
          'after a terminal reconnect drops mid-session.',
          '',
        ].join('\n'),
      );

      await update(workspaceSlug, 'docs');

      const hits = await runQmdSearch(
        workspace,
        'terminal reconnect',
        'docs',
        10,
        'lex',
        undefined,
      );

      const hit = hits.find((h) => h.displayPath === 'docs/terminal-reconnect.md');
      expect(hit).toBeDefined();
      expect(hit!.snippet).toBeDefined();
      expect(hit!.snippet).not.toContain('title:');
      expect(hit!.snippet).not.toMatch(/^---/);
      expect(hit!.snippet).toContain('reconnect');
    });

    it('[FR-SEARCH-016] should fall back to the raw body when frontmatter fails to parse', async () => {
      writeFixture(
        'docs/malformed.md',
        ['---', 'title: [unterminated', '---', '', 'Body content about widgets.', ''].join('\n'),
      );

      await update(workspaceSlug, 'docs');

      const hits = await runQmdSearch(workspace, 'widgets', 'docs', 10, 'lex', undefined);
      const hit = hits.find((h) => h.displayPath === 'docs/malformed.md');
      expect(hit).toBeDefined();
      expect(hit!.snippet).toContain('widgets');
    });
  });

  describe('runQmdSearch — lex mode relaxation', () => {
    it('[FR-SEARCH-017] should relax an over-restrictive natural-language query to find matches', async () => {
      writeFixture(
        'docs/session-resume.md',
        [
          '---',
          'title: Session Resume',
          '---',
          '',
          'The terminal automatically resumes the socket after a network drop;',
          'this is the reconnect flow.',
          '',
        ].join('\n'),
      );

      await update(workspaceSlug, 'docs');

      // Baseline: qmd's raw AND-joined query (every token required, including
      // "how"/"do"/"we") finds nothing since those don't appear in the doc.
      const store = await getStore(workspace);
      const raw = await store.searchLex('how do we handle terminal reconnect', {
        collection: 'docs',
        limit: 10,
      });
      expect(raw).toHaveLength(0);

      // runQmdSearch relaxes the same query (strips stop words to "handle
      // terminal reconnect", then drops "handle" — the shortest remaining
      // token, which isn't in the doc either) down to "terminal reconnect".
      const hits = await runQmdSearch(
        workspace,
        'how do we handle terminal reconnect',
        'docs',
        10,
        'lex',
        undefined,
      );

      expect(hits.some((h) => h.displayPath === 'docs/session-resume.md')).toBe(true);
    });

    it('[FR-SEARCH-017] should not relax a query that already returns results', async () => {
      writeFixture('docs/plain.md', `---\ntitle: Plain\n---\n\nJust a plain doc about widgets.\n`);
      await update(workspaceSlug, 'docs');

      const hits = await runQmdSearch(workspace, 'widgets', 'docs', 10, 'lex', undefined);
      expect(hits.some((h) => h.displayPath === 'docs/plain.md')).toBe(true);
    });

    it('should leave a query below the relaxation floor unrelaxed and return whatever qmd finds', async () => {
      writeFixture('docs/short.md', `---\ntitle: Short\n---\n\nA note about caching.\n`);
      await update(workspaceSlug, 'docs');

      const hits = await runQmdSearch(workspace, 'caching', 'docs', 10, 'lex', undefined);
      expect(hits.some((h) => h.displayPath === 'docs/short.md')).toBe(true);
    });

    it('should not relax quoted phrases or negated terms out of the query', async () => {
      writeFixture(
        'docs/exact-phrase.md',
        `---\ntitle: Exact Phrase\n---\n\nThis document is entirely about the exact phrase itself.\n`,
      );
      await update(workspaceSlug, 'docs');

      const hits = await runQmdSearch(
        workspace,
        '"exact phrase" -unrelated',
        'docs',
        10,
        'lex',
        undefined,
      );
      expect(hits.some((h) => h.displayPath === 'docs/exact-phrase.md')).toBe(true);
    });
  });
});
