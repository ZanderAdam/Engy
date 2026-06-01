// @rtm-ignore — embeds example [FR-…] tags as string fixtures, not real test
// titles; exclude from the repo-wide tag scan.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { appRouter } from '../trpc/root';
import { workspaces } from '../db/schema';
import { traceWorkspace, getWorkspaceMatrix } from './trace';

type WorkspaceRow = typeof workspaces.$inferSelect;

const FEATURE_DOC = `---
title: Search
---

# Search

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-SEARCH-001 | The system SHALL rank results by hybrid score. |
| FR-SEARCH-002 | The system SHALL anchor query+filter results on the filter. |
`;

describe('traceWorkspace', () => {
  let ctx: TestContext;
  let ws: WorkspaceRow;
  let wsDir: string;
  let codeDir: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    const caller = appRouter.createCaller({ state: ctx.state });
    const created = await caller.workspace.create({ name: 'Trace Test' });
    const db = getDb();
    ws = db.select().from(workspaces).where(eq(workspaces.slug, created.slug)).get()!;
    wsDir = path.join(ctx.tmpDir, ws.slug);

    // Feature doc with two FRs under system/features.
    const featuresDir = path.join(wsDir, 'system', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'search.md'), FEATURE_DOC);

    // A repo code root: one source + a test tagging FR-SEARCH-001 only.
    codeDir = path.join(ctx.tmpDir, 'repo');
    const src = path.join(codeDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'rank.ts'), 'export const rank = () => {};');
    fs.writeFileSync(
      path.join(src, 'rank.test.ts'),
      `it('[FR-SEARCH-001] ranks by score', () => {});\nit('[FR-SEARCH-404] orphan', () => {});`,
    );

    ws = { ...ws, repos: [codeDir] };
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('trace by FR', () => {
    it('should return requirement, tests, and colocated source for a covered FR', () => {
      const result = traceWorkspace(ws, { fr: 'FR-SEARCH-001' });
      expect(result.kind).toBe('fr');
      if (result.kind !== 'fr') throw new Error('unreachable');
      expect(result.found).toBe(true);
      expect(result.covered).toBe(true);
      expect(result.requirement?.text).toContain('SHALL rank');
      expect(result.tests).toHaveLength(1);
      expect(result.sources).toEqual(['src/rank.ts']);
    });

    it('should report an uncovered FR as found but not covered', () => {
      const result = traceWorkspace(ws, { fr: 'FR-SEARCH-002' });
      if (result.kind !== 'fr') throw new Error('unreachable');
      expect(result.found).toBe(true);
      expect(result.covered).toBe(false);
      expect(result.tests).toEqual([]);
    });

    it('should report an unknown FR as not found, surfacing orphan tags', () => {
      const result = traceWorkspace(ws, { fr: 'FR-SEARCH-404' });
      if (result.kind !== 'fr') throw new Error('unreachable');
      expect(result.found).toBe(false);
      expect(result.orphanTags.map((t) => t.id)).toEqual(['FR-SEARCH-404']);
    });
  });

  describe('trace by file', () => {
    it('should return FRs whose tests/source map to a source file', () => {
      const result = traceWorkspace(ws, { file: 'src/rank.ts' });
      if (result.kind !== 'file') throw new Error('unreachable');
      expect(result.coveredBy).toContainEqual({ fr: 'FR-SEARCH-001', role: 'source' });
    });

    it('should return FRs defined in a feature doc', () => {
      const result = traceWorkspace(ws, { file: 'system/features/search.md' });
      if (result.kind !== 'file') throw new Error('unreachable');
      expect(result.defines).toEqual(['FR-SEARCH-001', 'FR-SEARCH-002']);
    });
  });

  describe('trace summary', () => {
    it('should report totals, uncovered FRs, and orphan tags with no query', () => {
      const result = traceWorkspace(ws);
      if (result.kind !== 'summary') throw new Error('unreachable');
      expect(result.totals.definitions).toBe(2);
      expect(result.uncovered).toEqual(['FR-SEARCH-002']);
      expect(result.orphanTags.map((t) => t.id)).toEqual(['FR-SEARCH-404']);
    });
  });

  describe('getWorkspaceMatrix', () => {
    it('should skip the code scan gracefully when the workspace has no repos', () => {
      const matrix = getWorkspaceMatrix({ ...ws, repos: [] });
      expect(matrix.definitions).toHaveLength(2);
      expect(matrix.tags).toEqual([]);
      expect(matrix.uncovered).toHaveLength(2);
    });
  });
});
