import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { MemorySubtype } from '../db/schema';
import { regenerateReadmeChain } from './readme-index';
import { withWorkspaceLock } from './workspace-lock';

// ── Types ────────────────────────────────────────────────────────────

export interface PermanentMemoryFrontmatter {
  title: string;
  subtype: MemorySubtype;
  repo?: string;
  confidence?: number;
  keywords?: string[];
  themes?: string[];
  tags?: string[];
  linkedMemories?: string[];
  scenarioIds?: string[];
  sources?: string[];
  supersededBy?: string;
}

interface PermanentMemoryFile {
  frontmatter: PermanentMemoryFrontmatter;
  content: string;
  filePath: string;
}

interface SourceSnapshotFrontmatter {
  title: string;
  url?: string;
  origin?: string;
  source_type: string;
  ingester?: string;
  ingested_at?: string;
  content_hash: string;
}

interface SourceSnapshotFile {
  frontmatter: SourceSnapshotFrontmatter;
  body: string;
  filePath: string;
}

interface ReferenceRecordFrontmatter {
  title: string;
  url: string;
  type: string;
  description?: string;
}

interface ReferenceRecordFile {
  frontmatter: ReferenceRecordFrontmatter;
  filePath: string;
}

// ── Index marker escaping ────────────────────────────────────────────

export function escapeIndexMarkers(text: string): string {
  // Escape literal index markers in user-supplied content so they can't
  // corrupt parent README regeneration. Replace with HTML entity equivalents.
  return text
    .replace(/<!--\s*INDEX START\s*-->/g, '<!-\u200b- INDEX START -->')
    .replace(/<!--\s*INDEX END\s*-->/g, '<!-\u200b- INDEX END -->');
}

// ── Path validation ──────────────────────────────────────────────────

const VALID_SOURCE_DIRS = ['memory/sources', 'memory/references'];

// Subtype enum values (singular) → directory names (plural)
const SUBTYPE_DIR_MAP: Record<MemorySubtype, string> = {
  decision: 'decisions',
  pattern: 'patterns',
  fact: 'facts',
  convention: 'conventions',
  insight: 'insights',
};

const VALID_MEMORY_SUBTYPES: MemorySubtype[] = Object.keys(SUBTYPE_DIR_MAP) as MemorySubtype[];

function assertWithinAllowedDirs(
  relPath: string,
  workspaceDir: string,
  allowedDirs: string[],
  errorContext: string,
): void {
  if (path.isAbsolute(relPath)) {
    throw new Error(`${errorContext} must be relative, got absolute path: ${relPath}`);
  }
  if (relPath.split(/[/\\]/).includes('..')) {
    throw new Error(`${errorContext} must not contain '..' segments: ${relPath}`);
  }
  const resolved = path.resolve(workspaceDir, relPath);
  const allowed = allowedDirs.map((d) => path.resolve(workspaceDir, d));
  if (!allowed.some((dir) => resolved.startsWith(dir + path.sep) || resolved === dir)) {
    throw new Error(`${errorContext} must resolve under ${allowedDirs.join(' or ')}, got: ${relPath}`);
  }
}

export function validateSourcePath(sourcePath: string, workspaceDir: string): void {
  assertWithinAllowedDirs(sourcePath, workspaceDir, VALID_SOURCE_DIRS, 'Source path');
}

export function validateLinkedMemoryPath(linkedPath: string, workspaceDir: string): void {
  const allowed = Object.values(SUBTYPE_DIR_MAP).map((dirName) => `memory/${dirName}`);
  assertWithinAllowedDirs(linkedPath, workspaceDir, allowed, 'Linked memory path');
}

// ── Frontmatter parsing ──────────────────────────────────────────────

function requireStringArray(data: Record<string, unknown>, field: string): string[] {
  if (!(field in data)) return [];
  const val = data[field];
  if (!Array.isArray(val) || val.some((v) => typeof v !== 'string')) {
    throw new Error(
      `Frontmatter field '${field}' must be an array of strings, got: ${JSON.stringify(val)}`,
    );
  }
  return val as string[];
}

// Matches a closing --- fence at start-of-line followed by newline or EOF.
// Prevents false-positive matches on markdown HRs embedded in the body.
const CLOSING_FENCE_RE = /\r?\n---(?:\r?\n|$)/;

function parseMatterSafe(content: string): matter.GrayMatterFile<string> {
  // Accept both LF and CRLF opening fences
  if (!content.startsWith('---')) {
    throw new Error('Missing frontmatter: file must start with --- delimiters');
  }
  if (!CLOSING_FENCE_RE.test(content.slice(3))) {
    throw new Error('Malformed frontmatter: missing closing --- delimiter');
  }
  try {
    return matter(content);
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${(err as Error).message}`);
  }
}

// ── Commit subject sanitization ──────────────────────────────────────

export function sanitizeCommitSubject(title: string): string {
  return title.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72);
}

// ── Slug/timestamp helpers ────────────────────────────────────────────

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ── Git helpers ──────────────────────────────────────────────────────

export async function commitFile(
  workspaceDir: string,
  filePaths: string[],
  message: string,
): Promise<'committed' | 'skipped'> {
  const git = simpleGit(workspaceDir);
  const relPaths = filePaths.map((p) => path.relative(workspaceDir, p));
  await git.add(relPaths);
  const status = await git.status();
  if (status.staged.length === 0) {
    return 'skipped';
  }
  await git.commit(message);
  return 'committed';
}


// ── Write: Permanent Memory ──────────────────────────────────────────

export async function writePermanentMemory(
  workspaceDir: string,
  fm: PermanentMemoryFrontmatter,
  body: string,
  op: 'create' | 'promote' = 'promote',
): Promise<string> {
  if (fm.sources) {
    for (const s of fm.sources) validateSourcePath(s, workspaceDir);
  }
  if (fm.linkedMemories) {
    for (const l of fm.linkedMemories) validateLinkedMemoryPath(l, workspaceDir);
  }

  const safeFm: PermanentMemoryFrontmatter & Record<string, unknown> = {
    ...fm,
    keywords: fm.keywords ?? [],
    themes: fm.themes ?? [],
    tags: fm.tags ?? [],
    linkedMemories: fm.linkedMemories ?? [],
    scenarioIds: fm.scenarioIds ?? [],
    sources: fm.sources ?? [],
  };

  const slug = toSlug(fm.title);
  const ts = nowTimestamp();
  const filename = `${ts}-${slug}.md`;
  const dir = path.join(workspaceDir, 'memory', SUBTYPE_DIR_MAP[fm.subtype]);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);

  const safeBody = escapeIndexMarkers(body);
  const fileContent = matter.stringify(safeBody, safeFm);
  fs.writeFileSync(filePath, fileContent, 'utf8');

  const relPath = path.relative(workspaceDir, filePath).replace(/\\/g, '/');
  const safeTitle = sanitizeCommitSubject(fm.title);
  const msgBody = [
    `subtype: ${fm.subtype}`,
    fm.repo ? `repo: ${fm.repo}` : null,
    fm.sources?.length ? `sources: [${fm.sources.join(', ')}]` : null,
  ]
    .filter(Boolean)
    .join('\n');

  regenerateReadmeChain(filePath, workspaceDir);

  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  try {
    await withWorkspaceLock(workspaceDir, () =>
      commitFile(
        workspaceDir,
        [filePath, ...readmePaths],
        `memory(${op}): ${safeTitle}\n\nmemory_id: ${relPath}\n${msgBody}`,
      ),
    );
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
      regenerateReadmeChain(filePath, workspaceDir);
    } catch {
      // best-effort cleanup — ignore secondary failure
    }
    throw err;
  }

  return relPath;
}

// ── Read: Permanent Memory ───────────────────────────────────────────

export function readPermanentMemory(filePath: string, workspaceDir: string): PermanentMemoryFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseMatterSafe(raw);
  const data = parsed.data as Record<string, unknown>;

  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Permanent memory frontmatter must have a non-empty string title');
  }
  if (!VALID_MEMORY_SUBTYPES.includes(data.subtype as MemorySubtype)) {
    throw new Error(`Invalid subtype '${data.subtype}', must be one of: ${VALID_MEMORY_SUBTYPES.join(', ')}`);
  }

  const tags = requireStringArray(data, 'tags');
  const linkedMemories = requireStringArray(data, 'linkedMemories');
  const scenarioIds = requireStringArray(data, 'scenarioIds');
  const sources = requireStringArray(data, 'sources');

  for (const s of sources) validateSourcePath(s, workspaceDir);
  for (const l of linkedMemories) validateLinkedMemoryPath(l, workspaceDir);

  return {
    frontmatter: {
      title: data.title as string,
      subtype: data.subtype as MemorySubtype,
      repo: typeof data.repo === 'string' ? data.repo : undefined,
      confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
      keywords: requireStringArray(data, 'keywords'),
      themes: requireStringArray(data, 'themes'),
      tags,
      linkedMemories,
      scenarioIds,
      sources,
      supersededBy: typeof data.supersededBy === 'string' ? data.supersededBy : undefined,
    },
    content: parsed.content,
    filePath,
  };
}

// ── Write: Source Snapshot ───────────────────────────────────────────

export async function writeSourceSnapshot(
  workspaceDir: string,
  fm: Omit<SourceSnapshotFrontmatter, 'content_hash'>,
  body: string,
): Promise<{ filePath: string; deduplicated: boolean }> {
  const hash = sha256(body);

  // Dedup: scan existing sources for matching hash.
  // A cheap partial read of each file head avoids parsing full bodies.
  // A DB-backed index would reduce the O(n) scan but adding a db dependency
  // here would be invasive; source snapshot counts are bounded (KISS).
  const sourcesDir = path.join(workspaceDir, 'memory', 'sources');
  fs.mkdirSync(sourcesDir, { recursive: true });

  for (const fname of fs.readdirSync(sourcesDir)) {
    if (!fname.endsWith('.md')) continue;
    const fpath = path.join(sourcesDir, fname);
    try {
      const fd = fs.openSync(fpath, 'r');
      const buf = Buffer.alloc(512);
      const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      const head = buf.slice(0, bytesRead).toString('utf8');
      if (!head.includes(hash)) continue;
      const parsed = matter(fs.readFileSync(fpath, 'utf8'));
      if ((parsed.data as Record<string, unknown>).content_hash === hash) {
        const relPath = path.relative(workspaceDir, fpath).replace(/\\/g, '/');
        return { filePath: relPath, deduplicated: true };
      }
    } catch {
      // skip unreadable files
    }
  }

  const slug = toSlug(fm.title);
  const ts = nowTimestamp();
  const filename = `${ts}-${slug}.md`;
  const filePath = path.join(sourcesDir, filename);

  const safeFm: SourceSnapshotFrontmatter = { ...fm, content_hash: hash };
  const safeBody = escapeIndexMarkers(body);
  const fileContent = matter.stringify(safeBody, safeFm);
  fs.writeFileSync(filePath, fileContent, 'utf8');

  const relPath = path.relative(workspaceDir, filePath).replace(/\\/g, '/');
  const safeTitle = sanitizeCommitSubject(fm.title);

  regenerateReadmeChain(filePath, workspaceDir);
  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  await withWorkspaceLock(workspaceDir, () =>
    commitFile(
      workspaceDir,
      [filePath, ...readmePaths],
      `memory(ingest): ${safeTitle}\n\nsource_path: ${relPath}\nsource_type: ${fm.source_type}`,
    ),
  );

  return { filePath: relPath, deduplicated: false };
}

// ── Read: Source Snapshot ────────────────────────────────────────────

export function readSourceSnapshot(filePath: string): SourceSnapshotFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseMatterSafe(raw);
  const data = parsed.data as Record<string, unknown>;

  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Source snapshot frontmatter must have a non-empty string title');
  }
  if (typeof data.source_type !== 'string' || !data.source_type) {
    throw new Error('Source snapshot frontmatter must have a non-empty string source_type');
  }

  return {
    frontmatter: {
      title: data.title as string,
      url: typeof data.url === 'string' ? data.url : undefined,
      origin: typeof data.origin === 'string' ? data.origin : undefined,
      source_type: data.source_type as string,
      ingester: typeof data.ingester === 'string' ? data.ingester : undefined,
      ingested_at: typeof data.ingested_at === 'string' ? data.ingested_at : undefined,
      content_hash: typeof data.content_hash === 'string' ? data.content_hash : '',
    },
    body: parsed.content,
    filePath,
  };
}

// ── Write: Reference Record ──────────────────────────────────────────

export async function writeReferenceRecord(
  workspaceDir: string,
  fm: ReferenceRecordFrontmatter,
): Promise<string> {
  const dir = path.join(workspaceDir, 'memory', 'references');
  fs.mkdirSync(dir, { recursive: true });

  const slug = toSlug(fm.title);
  const filename = `${slug}.md`;
  const filePath = path.join(dir, filename);

  const fileContent = matter.stringify('', fm);
  fs.writeFileSync(filePath, fileContent, 'utf8');

  const relPath = path.relative(workspaceDir, filePath).replace(/\\/g, '/');
  const safeTitle = sanitizeCommitSubject(fm.title);

  regenerateReadmeChain(filePath, workspaceDir);
  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  await withWorkspaceLock(workspaceDir, () =>
    commitFile(
      workspaceDir,
      [filePath, ...readmePaths],
      `memory(ingest): ${safeTitle} reference\n\nsource_path: ${relPath}`,
    ),
  );

  return relPath;
}

// ── Read: Reference Record ────────────────────────────────────────────

export function readReferenceRecord(filePath: string): ReferenceRecordFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseMatterSafe(raw);
  const data = parsed.data as Record<string, unknown>;

  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Reference record frontmatter must have a non-empty string title');
  }
  if (typeof data.url !== 'string' || !data.url) {
    throw new Error('Reference record frontmatter must have a non-empty string url');
  }
  if (typeof data.type !== 'string' || !data.type) {
    throw new Error('Reference record frontmatter must have a non-empty string type');
  }

  return {
    frontmatter: {
      title: data.title as string,
      url: data.url as string,
      type: data.type as string,
      description: typeof data.description === 'string' ? data.description : undefined,
    },
    filePath,
  };
}

// ── Rewrite: Permanent Memory ────────────────────────────────────────

/**
 * Rewrite every memory file whose linkedMemories references oldRelPath to
 * point at newRelPath instead. Returns the absolute paths of rewritten files
 * so the caller can include them in its commit. The DB mirror catches up via
 * the post-mutation indexer sync.
 */
function rewriteInboundLinks(
  workspaceDir: string,
  oldRelPath: string,
  newRelPath: string,
): string[] {
  const rewritten: string[] = [];
  for (const dirName of Object.values(SUBTYPE_DIR_MAP)) {
    const dir = path.join(workspaceDir, 'memory', dirName);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') continue;
      const absPath = path.join(dir, file);
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(fs.readFileSync(absPath, 'utf8'));
      } catch {
        continue;
      }
      const linked = parsed.data.linkedMemories;
      if (!Array.isArray(linked) || !linked.includes(oldRelPath)) continue;
      parsed.data.linkedMemories = linked.map((l) => (l === oldRelPath ? newRelPath : l));
      fs.writeFileSync(absPath, matter.stringify(parsed.content, parsed.data), 'utf8');
      rewritten.push(absPath);
    }
  }
  return rewritten;
}

/**
 * Rewrite an existing permanent memory file in place (or relocate it when the
 * subtype changes). When the new subtype differs from the directory in
 * existingRelPath, the file is written at memory/{newSubtype}/{same filename},
 * the old file is removed, README chains are regenerated for both directories,
 * inbound linkedMemories references are repointed to the new path,
 * and all touched paths are committed in a single memory(edit): commit.
 *
 * @returns The (potentially new) relative filePath.
 */
export async function rewritePermanentMemory(
  workspaceDir: string,
  existingRelPath: string,
  fm: PermanentMemoryFrontmatter,
  body: string,
): Promise<string> {
  if (fm.sources) {
    for (const s of fm.sources) validateSourcePath(s, workspaceDir);
  }
  if (fm.linkedMemories) {
    for (const l of fm.linkedMemories) validateLinkedMemoryPath(l, workspaceDir);
  }

  // Validate that the path is under a known memory subtype directory.
  const allowed = Object.values(SUBTYPE_DIR_MAP).map((dirName) => `memory/${dirName}`);
  assertWithinAllowedDirs(existingRelPath, workspaceDir, allowed, 'Memory file path');

  const safeFm: PermanentMemoryFrontmatter & Record<string, unknown> = {
    ...fm,
    keywords: fm.keywords ?? [],
    themes: fm.themes ?? [],
    tags: fm.tags ?? [],
    linkedMemories: fm.linkedMemories ?? [],
    scenarioIds: fm.scenarioIds ?? [],
    sources: fm.sources ?? [],
  };

  const safeBody = escapeIndexMarkers(body);
  const fileContent = matter.stringify(safeBody, safeFm);

  const oldAbsPath = path.join(workspaceDir, existingRelPath);
  const expectedDir = `memory/${SUBTYPE_DIR_MAP[fm.subtype]}`;
  const existingDir = existingRelPath.split('/').slice(0, 2).join('/');
  const subtypeChanged = existingDir !== expectedDir;

  let newAbsPath: string;
  let newRelPath: string;

  if (subtypeChanged) {
    const newDir = path.join(workspaceDir, 'memory', SUBTYPE_DIR_MAP[fm.subtype]);
    fs.mkdirSync(newDir, { recursive: true });
    newAbsPath = path.join(newDir, path.basename(existingRelPath));
    newRelPath = path.relative(workspaceDir, newAbsPath).replace(/\\/g, '/');
  } else {
    newAbsPath = oldAbsPath;
    newRelPath = existingRelPath;
  }

  fs.writeFileSync(newAbsPath, fileContent, 'utf8');

  if (subtypeChanged) {
    fs.unlinkSync(oldAbsPath);
  }

  const safeTitle = sanitizeCommitSubject(fm.title);
  const msgBody = [
    `subtype: ${fm.subtype}`,
    fm.repo ? `repo: ${fm.repo}` : null,
    `title: ${fm.title}`,
  ]
    .filter(Boolean)
    .join('\n');

  regenerateReadmeChain(newAbsPath, workspaceDir);
  const newReadmePaths = collectReadmePaths(workspaceDir, newAbsPath);
  const pathsToCommit: string[] = [newAbsPath, ...newReadmePaths];

  if (subtypeChanged) {
    // Regenerate README chain for the old directory too, then stage it.
    regenerateReadmeChain(oldAbsPath, workspaceDir);
    const oldReadmePaths = collectReadmePaths(workspaceDir, oldAbsPath);
    pathsToCommit.push(oldAbsPath, ...oldReadmePaths);
    pathsToCommit.push(...rewriteInboundLinks(workspaceDir, existingRelPath, newRelPath));
  }

  await withWorkspaceLock(workspaceDir, () =>
    commitFile(
      workspaceDir,
      pathsToCommit,
      `memory(edit): ${safeTitle}\n\nmemory_id: ${newRelPath}\n${msgBody}`,
    ),
  );

  return newRelPath;
}

// ── Helpers ───────────────────────────────────────────────────────────

export function collectReadmePaths(workspaceDir: string, filePath: string): string[] {
  const results: string[] = [];
  let dir = path.dirname(filePath);
  const root = workspaceDir;

  // Walk up from the file's directory, inclusive of workspaceDir itself.
  while (dir.startsWith(root + path.sep) || dir === root) {
    const readme = path.join(dir, 'README.md');
    if (fs.existsSync(readme)) results.push(readme);
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return results;
}
