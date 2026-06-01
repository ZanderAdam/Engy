/**
 * Requirements traceability service — resolves a workspace to its feature docs
 * and repo code roots, builds the traceability matrix, and answers directional
 * `trace` queries (FR → tests → source, or file → FRs).
 *
 * This is the queryable surface over the deterministic scanner in
 * `../lib/requirements`. Shared by the `trace` MCP tool, the `trace` tRPC
 * procedure, and the requirements check in `./validate`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getWorkspaceDir } from '../engy-dir/init';
import {
  buildTraceabilityMatrix,
  type TraceabilityMatrix,
  type TraceEntry,
  type TestTag,
} from '../lib/requirements';

interface WorkspaceLike {
  slug: string;
  docsDir: string | null;
  repos: string[] | null;
}

interface TraceQuery {
  fr?: string;
  file?: string;
}

interface FrTraceResult {
  kind: 'fr';
  fr: string;
  found: boolean;
  covered: boolean;
  requirement?: { id: string; text: string; file: string; line: number };
  tests: TestTag[];
  sources: string[];
  orphanTags: TestTag[];
}

interface FileTraceResult {
  kind: 'file';
  file: string;
  defines: string[];
  coveredBy: { fr: string; role: 'source' | 'test' }[];
}

interface SummaryTraceResult {
  kind: 'summary';
  totals: { definitions: number; tags: number; uncovered: number; orphanTags: number };
  uncovered: string[];
  orphanTags: TestTag[];
  duplicateIds: string[];
  malformed: TraceabilityMatrix['malformed'];
}

type TraceResult = FrTraceResult | FileTraceResult | SummaryTraceResult;

/**
 * Build the traceability matrix for a workspace. Feature docs live under
 * `{workspaceDir}/system/features`; tagged tests are scanned across the
 * workspace's `repos[]` (existing paths only). Display paths are relative to
 * the first repo when present, else the workspace dir.
 */
export function getWorkspaceMatrix(ws: WorkspaceLike): TraceabilityMatrix {
  const workspaceDir = getWorkspaceDir(ws);
  const featuresDir = path.join(workspaceDir, 'system', 'features');
  const codeRoots = (ws.repos ?? []).filter((r) => fs.existsSync(r));
  const relativeTo = codeRoots[0] ?? workspaceDir;
  return buildTraceabilityMatrix({ featureDirs: [featuresDir], codeRoots, relativeTo });
}

/** Suffix-tolerant path match — accepts `foo.ts`, `src/foo.ts`, or absolute. */
function pathMatches(candidate: string, query: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const c = norm(candidate);
  const q = norm(query);
  return c === q || c.endsWith(`/${q}`) || q.endsWith(`/${c}`);
}

function traceFr(matrix: TraceabilityMatrix, fr: string): FrTraceResult {
  const entry: TraceEntry | undefined = matrix.entries.find((e) => e.fr.id === fr);
  const orphanTags = matrix.orphanTags.filter((t) => t.id === fr);

  if (!entry) {
    return { kind: 'fr', fr, found: false, covered: false, tests: [], sources: [], orphanTags };
  }
  return {
    kind: 'fr',
    fr,
    found: true,
    covered: entry.tests.length > 0,
    requirement: entry.fr,
    tests: entry.tests,
    sources: entry.sources,
    orphanTags,
  };
}

function traceFile(matrix: TraceabilityMatrix, file: string): FileTraceResult {
  const defines = matrix.definitions
    .filter((d) => pathMatches(d.file, file))
    .map((d) => d.id);

  const coveredBy: { fr: string; role: 'source' | 'test' }[] = [];
  for (const entry of matrix.entries) {
    if (entry.sources.some((s) => pathMatches(s, file))) {
      coveredBy.push({ fr: entry.fr.id, role: 'source' });
    } else if (entry.tests.some((t) => pathMatches(t.testFile, file))) {
      coveredBy.push({ fr: entry.fr.id, role: 'test' });
    }
  }
  return { kind: 'file', file, defines, coveredBy };
}

function traceSummary(matrix: TraceabilityMatrix): SummaryTraceResult {
  return {
    kind: 'summary',
    totals: {
      definitions: matrix.definitions.length,
      tags: matrix.tags.length,
      uncovered: matrix.uncovered.length,
      orphanTags: matrix.orphanTags.length,
    },
    uncovered: matrix.uncovered,
    orphanTags: matrix.orphanTags,
    duplicateIds: matrix.duplicateIds,
    malformed: matrix.malformed,
  };
}

/**
 * Answer a trace query against a workspace's matrix.
 *   - `{ fr }`   → that FR's requirement text, tests, and source.
 *   - `{ file }` → FRs defined in, or covered by, that file.
 *   - `{}`       → workspace-wide coverage summary (uncovered, orphans, etc.).
 */
export function traceWorkspace(ws: WorkspaceLike, query: TraceQuery = {}): TraceResult {
  const matrix = getWorkspaceMatrix(ws);
  if (query.fr) return traceFr(matrix, query.fr);
  if (query.file) return traceFile(matrix, query.file);
  return traceSummary(matrix);
}
