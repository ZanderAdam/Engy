// @rtm-ignore — this file embeds example [FR-…] tags as string fixtures, not
// real test titles, so it must be excluded from the repo-wide tag scan.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseRequirements,
  scanRequirementsDoc,
  collectFrDefinitions,
  findTestTags,
  mapTestToSource,
  buildTraceabilityMatrix,
  nextFreeId,
  FR_ID_PATTERN,
  type RepoFileAdapter,
} from './requirements';

const REQ_DOC = `---
title: Search
order: 1
---

# Search

Some prose that mentions FR-SEARCH-001 outside the section — must be ignored.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-SEARCH-001 | The system SHALL return results ranked by hybrid score. |
| FR-SEARCH-002 | WHEN a query and filters are both supplied, the system SHALL return every filter-matching row. |

## Behavior

More prose mentioning FR-SEARCH-999 that is not a real requirement.
`;

/**
 * Build an in-memory RepoFileAdapter from a map of absolute path → file content.
 * globTestFiles returns all keys under the given root that match *.test.ts(x).
 */
function makeFakeAdapter(map: Map<string, string>): RepoFileAdapter {
  return {
    globTestFiles(root: string): Promise<string[]> {
      const files = [...map.keys()].filter(
        (p) => p.startsWith(root) && /\.test\.tsx?$/.test(p),
      );
      return Promise.resolve(files);
    },
    readFile(absPath: string): Promise<string> {
      const content = map.get(absPath);
      if (content === undefined) return Promise.reject(new Error(`not found: ${absPath}`));
      return Promise.resolve(content);
    },
    exists(absPath: string): Promise<boolean> {
      return Promise.resolve(map.has(absPath));
    },
  };
}

describe('requirements', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-req-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseRequirements', () => {
    it('should parse FR rows from the Requirements table only', () => {
      const reqs = parseRequirements(REQ_DOC);
      expect(reqs.map((r) => r.id)).toEqual(['FR-SEARCH-001', 'FR-SEARCH-002']);
      expect(reqs[1].text).toContain('SHALL return every filter-matching row');
    });

    it('should ignore FR mentions outside the Requirements section', () => {
      const ids = parseRequirements(REQ_DOC).map((r) => r.id);
      expect(ids).not.toContain('FR-SEARCH-999');
    });

    it('should return empty when there is no Requirements section', () => {
      expect(parseRequirements('# Title\n\nNo requirements here.')).toEqual([]);
    });

    it('should skip the header and separator rows', () => {
      const reqs = parseRequirements(REQ_DOC);
      expect(reqs.every((r) => FR_ID_PATTERN.test(r.id))).toBe(true);
    });

    it('should stop at the next H2 boundary', () => {
      const doc = `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-A-001 | The system SHALL do a thing. |

## Other

| FR-A-002 | not a real requirement, wrong section |
`;
      expect(parseRequirements(doc).map((r) => r.id)).toEqual(['FR-A-001']);
    });

    it('should scan the raw file regardless of frontmatter validity', () => {
      const doc = `---
title: [unterminated
---
## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-X-001 | The system SHALL cope. |
`;
      // The scan slices by the `## Requirements` heading in the raw text, so
      // even unparseable frontmatter doesn't affect it.
      expect(parseRequirements(doc).map((r) => r.id)).toEqual(['FR-X-001']);
    });
  });

  describe('scanRequirementsDoc', () => {
    it('should flag a requirement missing SHALL', () => {
      const doc = `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-A-001 | The system returns results. |
`;
      const { requirements, malformed } = scanRequirementsDoc(doc);
      expect(requirements.map((r) => r.id)).toEqual(['FR-A-001']);
      expect(malformed).toHaveLength(1);
      expect(malformed[0].reason).toMatch(/missing SHALL/);
    });

    it('should flag a duplicate FR id within a doc and register it only once', () => {
      const doc = `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-A-001 | The system SHALL do X. |
| FR-A-001 | The system SHALL do X again. |
`;
      const { requirements, malformed } = scanRequirementsDoc(doc);
      expect(malformed.some((m) => /duplicate FR id FR-A-001/.test(m.reason))).toBe(true);
      // The repeat must NOT produce a second requirement entry.
      expect(requirements.map((r) => r.id)).toEqual(['FR-A-001']);
    });

    it('should flag an FR-ish id that fails the strict pattern', () => {
      const doc = `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-search-3 | The system SHALL use a bad id. |
`;
      const { requirements, malformed } = scanRequirementsDoc(doc);
      expect(requirements).toEqual([]);
      expect(malformed[0].reason).toMatch(/invalid FR id format/);
    });
  });

  describe('collectFrDefinitions', () => {
    it('should collect FRs across feature docs sorted by id', () => {
      const featuresDir = path.join(tmpDir, 'system', 'features');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'search.md'), REQ_DOC);
      fs.writeFileSync(
        path.join(featuresDir, 'memory.md'),
        `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-MEMORY-001 | The system SHALL persist memories. |
`,
      );
      // README files in the features dir must be ignored.
      fs.writeFileSync(path.join(featuresDir, 'README.md'), '# index\nFR-SEARCH-001 mention');

      const { definitions, duplicateIds } = collectFrDefinitions([featuresDir], tmpDir);
      expect(definitions.map((d) => d.id)).toEqual([
        'FR-MEMORY-001',
        'FR-SEARCH-001',
        'FR-SEARCH-002',
      ]);
      expect(definitions[0].file).toBe('system/features/memory.md');
      expect(definitions[0].line).toBeGreaterThan(0);
      expect(duplicateIds).toEqual([]);
    });

    it('should report duplicate ids across docs', () => {
      const dir = path.join(tmpDir, 'features');
      fs.mkdirSync(dir, { recursive: true });
      const body = `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-A-001 | The system SHALL do X. |
`;
      fs.writeFileSync(path.join(dir, 'a.md'), body);
      fs.writeFileSync(path.join(dir, 'b.md'), body);

      const { duplicateIds } = collectFrDefinitions([dir], tmpDir);
      expect(duplicateIds).toEqual(['FR-A-001']);
    });
  });

  describe('findTestTags', () => {
    it('should find FR tags in test titles with file and line', async () => {
      const dir = path.join(tmpDir, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'foo.test.ts'),
        `describe('[FR-SEARCH-002] filter search', () => {
  it('[FR-SEARCH-001] ranks by score', () => {});
});
`,
      );
      // non-test file with a tag-like string must be ignored
      fs.writeFileSync(path.join(dir, 'foo.ts'), `// [FR-SEARCH-001] not a test`);

      const tags = await findTestTags([dir], tmpDir);
      expect(tags.map((t) => t.id).sort()).toEqual(['FR-SEARCH-001', 'FR-SEARCH-002']);
      const first = tags.find((t) => t.id === 'FR-SEARCH-002')!;
      expect(first.testFile).toBe('src/foo.test.ts');
      expect(first.line).toBe(1);
    });

    it('should skip node_modules and dist', async () => {
      const nm = path.join(tmpDir, 'node_modules', 'pkg');
      fs.mkdirSync(nm, { recursive: true });
      fs.writeFileSync(path.join(nm, 'x.test.ts'), `it('[FR-A-001] noise', () => {});`);
      expect(await findTestTags([tmpDir], tmpDir)).toEqual([]);
    });

    it('should skip files carrying the @rtm-ignore marker', async () => {
      const dir = path.join(tmpDir, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'fixtures.test.ts'),
        `// @rtm-ignore\nit('[FR-A-001] example fixture, not a real test', () => {});`,
      );
      expect(await findTestTags([dir], tmpDir)).toEqual([]);
    });

    it('should dedupe overlapping code roots', async () => {
      const dir = path.join(tmpDir, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'a.test.ts'), `it('[FR-A-001] x', () => {});`);
      const tags = await findTestTags([tmpDir, dir], tmpDir);
      expect(tags).toHaveLength(1);
    });
  });

  describe('mapTestToSource', () => {
    it('should map a colocated source that exists on disk', async () => {
      const dir = path.join(tmpDir, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'foo.ts'), 'export const x = 1;');
      expect(await mapTestToSource('src/foo.test.ts', tmpDir)).toBe('src/foo.ts');
    });

    it('should return null when the source does not exist', async () => {
      expect(await mapTestToSource('src/missing.test.ts', tmpDir)).toBeNull();
    });

    it('should return null for a non-test path', async () => {
      expect(await mapTestToSource('src/foo.ts', tmpDir)).toBeNull();
    });
  });

  describe('buildTraceabilityMatrix', () => {
    function fixture(): { featuresDir: string; srcDir: string } {
      const featuresDir = path.join(tmpDir, 'system', 'features');
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(featuresDir, 'search.md'),
        `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-SEARCH-001 | The system SHALL rank by score. |
| FR-SEARCH-002 | The system SHALL anchor on filters. |
| FR-SEARCH-003 | The system SHALL fall back to lexical ranking. |
`,
      );

      fs.writeFileSync(path.join(srcDir, 'rank.ts'), 'export const rank = () => {};');
      fs.writeFileSync(
        path.join(srcDir, 'rank.test.ts'),
        `it('[FR-SEARCH-001] ranks by score', () => {});
it('[FR-SEARCH-002] anchors on filters', () => {});
it('[FR-SEARCH-404] orphan tag, no such FR', () => {});
`,
      );
      return { featuresDir, srcDir };
    }

    it('should join FR → tests → source for covered FRs', async () => {
      const { featuresDir, srcDir } = fixture();
      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [srcDir],
        relativeTo: tmpDir,
      });

      const fr1 = m.entries.find((e) => e.fr.id === 'FR-SEARCH-001')!;
      expect(fr1.tests).toHaveLength(1);
      expect(fr1.tests[0].testFile).toBe('src/rank.test.ts');
      expect(fr1.sources).toEqual(['src/rank.ts']);
    });

    it('should expose the from-docs and from-tests lists for comparison', async () => {
      const { featuresDir, srcDir } = fixture();
      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [srcDir],
        relativeTo: tmpDir,
      });
      expect(m.definitions.map((d) => d.id)).toEqual([
        'FR-SEARCH-001',
        'FR-SEARCH-002',
        'FR-SEARCH-003',
      ]);
      expect(m.tags.map((t) => t.id).sort()).toEqual([
        'FR-SEARCH-001',
        'FR-SEARCH-002',
        'FR-SEARCH-404',
      ]);
    });

    it('should flag uncovered FRs (declared, never tagged)', async () => {
      const { featuresDir, srcDir } = fixture();
      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [srcDir],
        relativeTo: tmpDir,
      });
      expect(m.uncovered).toEqual(['FR-SEARCH-003']);
    });

    it('should flag orphan tags (tagged, never declared)', async () => {
      const { featuresDir, srcDir } = fixture();
      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [srcDir],
        relativeTo: tmpDir,
      });
      expect(m.orphanTags.map((t) => t.id)).toEqual(['FR-SEARCH-404']);
    });

    it('should treat everything as uncovered when no code roots are scanned', async () => {
      const { featuresDir } = fixture();
      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [],
        relativeTo: tmpDir,
      });
      expect(m.uncovered).toHaveLength(3);
      expect(m.orphanTags).toEqual([]);
    });

    it('should use an injected adapter for repo file reads', async () => {
      const featuresDir = path.join(tmpDir, 'system', 'features');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(
        path.join(featuresDir, 'search.md'),
        `## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-SEARCH-001 | The system SHALL rank by score. |
| FR-SEARCH-002 | The system SHALL anchor on filters. |
`,
      );

      // In-memory repo: one test file tagging FR-SEARCH-001, a colocated source
      const repoRoot = '/fake/repo';
      const testFile = `${repoRoot}/src/rank.test.ts`;
      const sourceFile = `${repoRoot}/src/rank.ts`;
      const fileMap = new Map<string, string>([
        [testFile, `it('[FR-SEARCH-001] ranks by score', () => {});`],
        [sourceFile, `export const rank = () => {};`],
      ]);
      const adapter = makeFakeAdapter(fileMap);

      const m = await buildTraceabilityMatrix({
        featureDirs: [featuresDir],
        codeRoots: [repoRoot],
        relativeTo: repoRoot,
        adapter,
      });

      expect(m.tags.map((t) => t.id)).toEqual(['FR-SEARCH-001']);
      expect(m.uncovered).toEqual(['FR-SEARCH-002']);
      expect(m.orphanTags).toEqual([]);

      const fr1 = m.entries.find((e) => e.fr.id === 'FR-SEARCH-001')!;
      expect(fr1.tests).toHaveLength(1);
      expect(fr1.sources).toEqual(['src/rank.ts']);
    });
  });

  describe('nextFreeId', () => {
    it('should allocate the first id for a fresh area', () => {
      expect(nextFreeId('SEARCH', [])).toBe('FR-SEARCH-001');
    });

    it('should allocate after the current max for the area', () => {
      expect(nextFreeId('SEARCH', ['FR-SEARCH-001', 'FR-SEARCH-004', 'FR-MEMORY-009'])).toBe(
        'FR-SEARCH-005',
      );
    });

    it('should honor a gap to leave room and never reuse', () => {
      expect(nextFreeId('SEARCH', ['FR-SEARCH-010'], 10)).toBe('FR-SEARCH-020');
    });

    it('should preserve numeric width', () => {
      expect(nextFreeId('A', ['FR-A-0005'])).toBe('FR-A-0006');
    });
  });
});
