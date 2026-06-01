/**
 * Requirements traceability: parse EARS functional requirements (FRs) from
 * feature-doc bodies, find their FR tags in test files, and cross-reference
 * the two into a traceability matrix (RTM).
 *
 * Everything here is a deterministic *static* scan — it reads markdown and
 * test source as text and never executes the test suite. That is what lets
 * the matrix flag orphan tags and uncovered FRs even when the suite is
 * broken, skipped, or only partially collected.
 *
 * Source of truth:
 *   - FR definitions live in the BODY of `system/features/<area>.md`, in a
 *     `## Requirements` markdown table (`| ID | Requirement (EARS) |`).
 *   - Tests are tagged by putting the FR id in the describe/it title string,
 *     e.g. `it('[FR-SEARCH-003] returns filter matches', ...)`.
 *   - Source is derived from the colocated-test convention (`foo.test.ts` ↔
 *     `foo.ts`) — the test is the executable pivot between FR and code.
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Patterns ─────────────────────────────────────────────────────────

/** Canonical FR id: `FR-<AREA>-<NNN>`, AREA = uppercase letters only. */
export const FR_ID_PATTERN = /^FR-[A-Z]+-\d+$/;

/** An FR id embedded in a test title string, e.g. `[FR-SEARCH-003]`. */
const FR_TAG_PATTERN = /\[(FR-[A-Z]+-\d+)\]/g;

/** Looks-like-an-FR-id (for malformed detection), case-insensitive. */
const FR_ISH_PATTERN = /^fr-[a-z0-9]*-?\d*/i;

/**
 * Opt-out marker. A test file containing this string is skipped by the tag
 * scan — for the rare file (e.g. the traceability scanner's own tests) that
 * embeds example `[FR-…]` tags as string fixtures rather than real test titles.
 */
const IGNORE_MARKER = '@rtm-ignore';

/** Directories never worth walking when scanning for test files. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

// ── Types ────────────────────────────────────────────────────────────

interface Requirement {
  id: string;
  text: string;
}

export interface MalformedRow {
  file: string;
  line: number;
  raw: string;
  reason: string;
}

export interface FrDefinition extends Requirement {
  /** Display path to the feature doc that defines this FR. */
  file: string;
  /** 1-based line of the FR's table row in the file. */
  line: number;
}

export interface TestTag {
  id: string;
  /** Display path to the test file. */
  testFile: string;
  line: number;
  /** The trimmed title line carrying the tag — greppable context. */
  testName: string;
}

export interface TraceEntry {
  fr: FrDefinition;
  tests: TestTag[];
  /** Colocated source files derived from the tagged tests, that exist on disk. */
  sources: string[];
}

export interface TraceabilityMatrix {
  /** FRs declared in feature docs (the "from docs" list). */
  definitions: FrDefinition[];
  /** FR tags found across test files (the "from tests" list). */
  tags: TestTag[];
  /** Per-FR join of definition → tests → source, sorted by id. */
  entries: TraceEntry[];
  /** Declared FRs with zero tagged tests (coverage gaps). */
  uncovered: string[];
  /** Tags referencing an FR id that no doc declares (typos / orphans). */
  orphanTags: TestTag[];
  /** FR ids declared in more than one place. */
  duplicateIds: string[];
  /** Rows in a `## Requirements` table that violate the format contract. */
  malformed: MalformedRow[];
}

/**
 * Seam for repo file operations. The default implementation (localRepoAdapter)
 * uses the local filesystem directly. Prod callers inject a daemon-backed
 * adapter so the server never touches user repos itself.
 */
export interface RepoFileAdapter {
  /** Return absolute paths of all test files (*.test.ts / *.test.tsx) under root. */
  globTestFiles(root: string): Promise<string[]>;
  /** Read a file as UTF-8 text. */
  readFile(absPath: string): Promise<string>;
  /** Return true if the absolute path exists on the repo filesystem. */
  exists(absPath: string): Promise<boolean>;
}

interface TraceOptions {
  /** Absolute dirs holding feature docs (`system/features`). */
  featureDirs: string[];
  /** Absolute roots to scan for `*.test.ts` / `*.test.tsx`. */
  codeRoots: string[];
  /** Base for display paths (default: `process.cwd()`). */
  relativeTo?: string;
  /**
   * Adapter for repo file I/O. Defaults to localRepoAdapter (local fs).
   * Inject a daemon-backed adapter to route reads through the client daemon.
   */
  adapter?: RepoFileAdapter;
}

// ── Markdown table parsing ───────────────────────────────────────────

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Return the lines inside the first `## Requirements` section, sliced at the
 * next heading of any level. Section-scoping is required so prose mentions of
 * an FR id elsewhere in the doc (or in frontmatter) are not picked up. Scans
 * the raw file so line numbers are file-absolute. Returns null when absent.
 */
function sliceRequirementsSection(raw: string): { lines: string[]; offset: number } | null {
  const lines = raw.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Requirements\s*$/i.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,6}\s+\S/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return { lines: lines.slice(start, end), offset: start };
}

// ── Public: parse & scan a single doc ────────────────────────────────

/**
 * Extract the valid FRs from a feature-doc body. Lenient: returns only
 * well-formed rows. Use scanRequirementsDoc when you also need the format
 * violations (for linting).
 */
export function parseRequirements(raw: string): Requirement[] {
  return scanRequirementsDoc(raw).requirements;
}

/**
 * Scan a feature doc for both valid FRs and format violations.
 * Line numbers are 1-based and file-absolute.
 */
export function scanRequirementsDoc(raw: string): {
  requirements: Requirement[];
  malformed: Omit<MalformedRow, 'file'>[];
} {
  const section = sliceRequirementsSection(raw);
  if (!section) return { requirements: [], malformed: [] };

  const requirements: Requirement[] = [];
  const malformed: Omit<MalformedRow, 'file'>[] = [];
  const seen = new Set<string>();

  section.lines.forEach((line, idx) => {
    const cells = splitTableRow(line);
    if (!cells || cells.length < 2 || isSeparatorRow(cells)) return;

    const id = cells[0];
    const text = cells[1];
    const lineNo = section.offset + idx + 1;

    if (FR_ID_PATTERN.test(id)) {
      if (seen.has(id)) {
        // Flag the repeat but do not register a second definition — a duplicate
        // would otherwise produce two matrix entries for one id.
        malformed.push({ line: lineNo, raw: line.trim(), reason: `duplicate FR id ${id}` });
        return;
      }
      seen.add(id);

      if (!/\bshall\b/i.test(text)) {
        malformed.push({
          line: lineNo,
          raw: line.trim(),
          reason: `requirement ${id} is missing SHALL`,
        });
      }
      requirements.push({ id, text });
      return;
    }

    // A cell that looks like an FR id but fails the strict pattern is a typo,
    // not a header/prose row — surface it so the format stays disciplined.
    if (FR_ISH_PATTERN.test(id)) {
      malformed.push({ line: lineNo, raw: line.trim(), reason: `invalid FR id format: "${id}"` });
    }
  });

  return { requirements, malformed };
}

// ── Filesystem helpers ───────────────────────────────────────────────

function toDisplayPath(absPath: string, relativeTo: string): string {
  return path.relative(relativeTo, absPath).replace(/\\/g, '/');
}

/**
 * Synchronous recursive file walker for server-owned data (ENGY_DIR markdown).
 * This path is intentionally NOT routed through RepoFileAdapter — it reads
 * feature docs from the server's own data directory, not from user repos.
 */
function collectFiles(dir: string, match: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, match));
    } else if (entry.isFile() && match(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const isMarkdown = (name: string): boolean => name.endsWith('.md');
const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);

// ── Default local-fs RepoFileAdapter ─────────────────────────────────

/**
 * Default adapter that reads repo files directly from the local filesystem.
 * Reproduces the original synchronous behaviour via async wrappers so colocated
 * dev and existing tests are unchanged when no adapter is injected.
 */
export const localRepoAdapter: RepoFileAdapter = {
  globTestFiles(root: string): Promise<string[]> {
    return Promise.resolve(collectFiles(root, isTestFile));
  },

  readFile(absPath: string): Promise<string> {
    return Promise.resolve(fs.readFileSync(absPath, 'utf8'));
  },

  exists(absPath: string): Promise<boolean> {
    return Promise.resolve(fs.existsSync(absPath));
  },
};

// ── Public: collect across the tree ──────────────────────────────────

/**
 * Parse FR definitions from every feature doc under the given dirs.
 * `malformed` and `duplicateIds` aggregate the format violations across docs.
 *
 * Reads server-owned ENGY_DIR markdown — stays SYNC, NOT routed through adapter.
 */
export function collectFrDefinitions(
  featureDirs: string[],
  relativeTo: string = process.cwd(),
): { definitions: FrDefinition[]; malformed: MalformedRow[]; duplicateIds: string[] } {
  const definitions: FrDefinition[] = [];
  const malformed: MalformedRow[] = [];
  const idCounts = new Map<string, number>();

  for (const dir of featureDirs) {
    for (const absPath of collectFiles(dir, isMarkdown)) {
      if (path.basename(absPath).toLowerCase() === 'readme.md') continue;

      let raw: string;
      try {
        raw = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const file = toDisplayPath(absPath, relativeTo);
      const { requirements, malformed: docMalformed } = scanRequirementsDoc(raw);

      for (const req of requirements) {
        idCounts.set(req.id, (idCounts.get(req.id) ?? 0) + 1);
        definitions.push({ ...req, file, line: lineOfId(raw, req.id) });
      }
      for (const m of docMalformed) malformed.push({ ...m, file });
    }
  }

  const duplicateIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
  definitions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { definitions, malformed, duplicateIds };
}

/** 1-based file line of the first table row whose ID column equals `id`. */
function lineOfId(raw: string, id: string): number {
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    if (cells && cells[0] === id) return i + 1;
  }
  return 0;
}

/** Find every `[FR-…]` tag across the test files under the given roots. */
export async function findTestTags(
  codeRoots: string[],
  relativeTo: string = process.cwd(),
  adapter: RepoFileAdapter = localRepoAdapter,
): Promise<TestTag[]> {
  const tags: TestTag[] = [];
  const seenFiles = new Set<string>();

  for (const root of codeRoots) {
    const files = await adapter.globTestFiles(root);
    for (const absPath of files) {
      // Roots may overlap or nest — dedupe on the resolved file path so a test
      // discovered via two roots is scanned once.
      const resolved = path.resolve(absPath);
      if (seenFiles.has(resolved)) continue;
      seenFiles.add(resolved);

      let content: string;
      try {
        content = await adapter.readFile(absPath);
      } catch {
        continue;
      }
      if (content.includes(IGNORE_MARKER)) continue;
      const testFile = toDisplayPath(absPath, relativeTo);
      content.split('\n').forEach((line, idx) => {
        for (const m of line.matchAll(FR_TAG_PATTERN)) {
          tags.push({ id: m[1], testFile, line: idx + 1, testName: line.trim() });
        }
      });
    }
  }
  return tags;
}

/**
 * Map a test file to its colocated source via the `foo.test.ts ↔ foo.ts`
 * convention. Returns the source display path if it exists on disk, else null.
 */
export async function mapTestToSource(
  testDisplayPath: string,
  relativeTo: string,
  adapter: RepoFileAdapter = localRepoAdapter,
): Promise<string | null> {
  const sourceRel = testDisplayPath.replace(/\.test\.(tsx?)$/, '.$1');
  if (sourceRel === testDisplayPath) return null;
  const abs = path.resolve(relativeTo, sourceRel);
  return (await adapter.exists(abs)) ? sourceRel : null;
}

// ── Public: the matrix ───────────────────────────────────────────────

/**
 * Cross-reference FR definitions (from docs) against FR tags (from tests) into
 * a traceability matrix. Both lists are exposed so callers can compare them
 * directly; the derived `uncovered` / `orphanTags` are the two-way diff.
 */
export async function buildTraceabilityMatrix(opts: TraceOptions): Promise<TraceabilityMatrix> {
  const relativeTo = opts.relativeTo ?? process.cwd();
  const adapter = opts.adapter ?? localRepoAdapter;
  const { definitions, malformed, duplicateIds } = collectFrDefinitions(
    opts.featureDirs,
    relativeTo,
  );
  const tags = await findTestTags(opts.codeRoots, relativeTo, adapter);

  const definedIds = new Set(definitions.map((d) => d.id));
  const tagsById = new Map<string, TestTag[]>();
  for (const tag of tags) {
    const list = tagsById.get(tag.id) ?? [];
    list.push(tag);
    tagsById.set(tag.id, list);
  }

  const entries: TraceEntry[] = await Promise.all(
    definitions.map(async (fr) => {
      const frTests = tagsById.get(fr.id) ?? [];
      const sourcePaths = await Promise.all(
        frTests.map((t) => mapTestToSource(t.testFile, relativeTo, adapter)),
      );
      const sources = [...new Set(sourcePaths.filter((s): s is string => !!s))].sort();
      return { fr, tests: frTests, sources };
    }),
  );

  const uncovered = entries.filter((e) => e.tests.length === 0).map((e) => e.fr.id);
  const orphanTags = tags.filter((t) => !definedIds.has(t.id));

  return { definitions, tags, entries, uncovered, orphanTags, duplicateIds, malformed };
}

// ── Public: id allocation ────────────────────────────────────────────

/**
 * Next free FR id for an area, allocated with a gap so ids stay stable and
 * are never reused. `gap` defaults to 1 (consecutive); pass e.g. 10 to leave
 * room. Existing ids are scanned for the area's max numeric suffix.
 */
export function nextFreeId(area: string, existingIds: string[], gap: number = 1): string {
  const prefix = `FR-${area.toUpperCase()}-`;
  let max = 0;
  let width = 3;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const numPart = id.slice(prefix.length);
    const n = Number.parseInt(numPart, 10);
    if (Number.isFinite(n)) {
      max = Math.max(max, n);
      width = Math.max(width, numPart.length);
    }
  }
  const next = max + gap;
  return `${prefix}${String(next).padStart(width, '0')}`;
}
