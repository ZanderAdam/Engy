import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { MemorySubtype } from '../db/schema';
import { regenerateReadmeChain } from './readme-index';

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

function parseMatterSafe(content: string): matter.GrayMatterFile<string> {
  if (!content.startsWith('---')) {
    throw new Error('Missing frontmatter: file must start with --- delimiters');
  }
  const secondDelim = content.indexOf('\n---', 3);
  if (secondDelim === -1) {
    throw new Error('Malformed frontmatter: missing closing --- delimiter');
  }
  try {
    return matter(content);
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${(err as Error).message}`);
  }
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

async function commitFile(
  workspaceDir: string,
  filePaths: string[],
  message: string,
): Promise<void> {
  const git = simpleGit(workspaceDir);
  // Add relative paths to git
  const relPaths = filePaths.map((p) => path.relative(workspaceDir, p));
  await git.add(relPaths);
  await git.commit(message, { '--allow-empty': null });
}


// ── Write: Permanent Memory ──────────────────────────────────────────

export async function writePermanentMemory(
  workspaceDir: string,
  fm: PermanentMemoryFrontmatter,
  body: string,
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
  const msgBody = [
    `subtype: ${fm.subtype}`,
    fm.repo ? `repo: ${fm.repo}` : null,
    fm.sources?.length ? `sources: [${fm.sources.join(', ')}]` : null,
  ]
    .filter(Boolean)
    .join('\n');

  regenerateReadmeChain(filePath);

  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  await commitFile(
    workspaceDir,
    [filePath, ...readmePaths],
    `memory(promote): ${fm.title}\n\nmemory_id: ${relPath}\n${msgBody}`,
  );

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

  // Dedup: scan existing sources for matching hash
  const sourcesDir = path.join(workspaceDir, 'memory', 'sources');
  fs.mkdirSync(sourcesDir, { recursive: true });

  for (const fname of fs.readdirSync(sourcesDir)) {
    if (!fname.endsWith('.md')) continue;
    const fpath = path.join(sourcesDir, fname);
    try {
      const raw = fs.readFileSync(fpath, 'utf8');
      const parsed = matter(raw);
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

  regenerateReadmeChain(filePath);
  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  await commitFile(
    workspaceDir,
    [filePath, ...readmePaths],
    `memory(ingest): ${fm.title}\n\nsource_path: ${relPath}\nsource_type: ${fm.source_type}`,
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

  regenerateReadmeChain(filePath);
  const readmePaths = collectReadmePaths(workspaceDir, filePath);
  await commitFile(
    workspaceDir,
    [filePath, ...readmePaths],
    `memory(ingest): ${fm.title} reference\n\nsource_path: ${relPath}`,
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
 * Rewrite an existing permanent memory file in place.
 *
 * Unlike writePermanentMemory, this does NOT generate a new timestamped filename.
 * It reads the existing filePath, validates it lives under memory/{subtype}/,
 * overwrites it with the new frontmatter + body, regenerates the README chain,
 * and commits with a memory(edit) message.
 *
 * @returns The (unchanged) relative filePath.
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
  const absPath = path.isAbsolute(existingRelPath)
    ? existingRelPath
    : path.join(workspaceDir, existingRelPath);
  fs.writeFileSync(absPath, fileContent, 'utf8');

  const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
  const msgBody = [
    `subtype: ${fm.subtype}`,
    fm.repo ? `repo: ${fm.repo}` : null,
    `title: ${fm.title}`,
  ]
    .filter(Boolean)
    .join('\n');

  regenerateReadmeChain(absPath);

  const readmePaths = collectReadmePaths(workspaceDir, absPath);
  await commitFile(
    workspaceDir,
    [absPath, ...readmePaths],
    `memory(edit): ${fm.title}\n\nmemory_id: ${relPath}\n${msgBody}`,
  );

  return relPath;
}

// ── Helpers ───────────────────────────────────────────────────────────

function collectReadmePaths(workspaceDir: string, filePath: string): string[] {
  const results: string[] = [];
  let dir = path.dirname(filePath);
  const root = workspaceDir;
  while (dir !== root && dir.startsWith(root)) {
    const readme = path.join(dir, 'README.md');
    if (fs.existsSync(readme)) results.push(readme);
    dir = path.dirname(dir);
  }
  return results;
}
