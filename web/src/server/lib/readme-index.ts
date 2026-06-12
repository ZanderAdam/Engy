import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

// ── Constants ────────────────────────────────────────────────────────

const INDEX_START = '<!-- INDEX START -->';
const INDEX_END = '<!-- INDEX END -->';

// ── Markdown escaping ────────────────────────────────────────────────

function escapeTocEntry(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]')
    .replace(/\)/g, '\\)')
    .replace(/<!--\s*INDEX START\s*-->/g, '<!-\u200b- INDEX START -->')
    .replace(/<!--\s*INDEX END\s*-->/g, '<!-\u200b- INDEX END -->');
}

// ── Fallback description extraction ──────────────────────────────────

function extractDescription(filePath: string): string {
  if (!fs.existsSync(filePath)) return path.basename(filePath, '.md');

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return path.basename(filePath, '.md');
  }

  // Try frontmatter description field first
  try {
    const parsed = matter(raw);
    const desc = (parsed.data as Record<string, unknown>).description;
    if (typeof desc === 'string' && desc.trim()) return desc.trim();
  } catch {
    // fall through
  }

  // Try first H1
  const h1Match = raw.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Try first non-empty prose line (skip frontmatter block and headings)
  const lines = raw.split('\n');
  let delimCount = 0;
  for (const line of lines) {
    if (line.trim() === '---') {
      delimCount++;
      continue;
    }
    if (delimCount < 2) continue;
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--')) {
      return trimmed.slice(0, 80);
    }
  }

  return path.basename(filePath, '.md');
}

// ── Reading-order extraction ─────────────────────────────────────────

/**
 * Read the numeric `order` frontmatter field — the reading position of a doc
 * within its directory. Files without it sort last (Infinity), then alphabetically.
 */
function extractOrder(filePath: string): number {
  if (!fs.existsSync(filePath)) return Infinity;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const order = (matter(raw).data as Record<string, unknown>).order;
    if (typeof order === 'number' && Number.isFinite(order)) return order;
  } catch {
    // fall through
  }
  return Infinity;
}

// ── Index generation ─────────────────────────────────────────────────

function subdirBullet(dirPath: string, subdir: string, noun: string): string {
  const desc = extractDescription(path.join(dirPath, subdir, 'README.md'));
  const count = countMdFiles(path.join(dirPath, subdir));
  const countStr = count > 0 ? ` (${count} ${noun}s)` : '';
  return `- [${escapeTocEntry(subdir)}](${subdir}/) — ${escapeTocEntry(desc)}${countStr}`;
}

function buildIndexBlock(dirPath: string, noun: string): string {
  if (!fs.existsSync(dirPath)) return `${INDEX_START}\n${INDEX_END}`;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // Files sort by `order` frontmatter first (curated reading order), then alphabetically.
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => {
      const filePath = path.join(dirPath, e.name);
      return { name: e.name, order: extractOrder(filePath), desc: extractDescription(filePath) };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const fileBullet = (f: { name: string; desc: string }) =>
    `- [${escapeTocEntry(f.name)}](${f.name}) — ${escapeTocEntry(f.desc)}`;
  const filesHeader = `**${noun.charAt(0).toUpperCase()}${noun.slice(1)}s**`;

  const lines: string[] = [INDEX_START];

  if (subdirs.length > 0 && files.length > 0) {
    // Mixed dir: emit both sections
    lines.push('', '**Sections**', '');
    for (const subdir of subdirs) lines.push(subdirBullet(dirPath, subdir, noun));
    lines.push('', filesHeader, '');
    for (const f of files) lines.push(fileBullet(f));
  } else if (subdirs.length > 0) {
    lines.push('');
    for (const subdir of subdirs) lines.push(subdirBullet(dirPath, subdir, noun));
  } else if (files.length > 0) {
    lines.push('');
    for (const f of files) lines.push(fileBullet(f));
  } else {
    lines.push('', '- (empty)');
  }

  lines.push('', INDEX_END);
  return lines.join('\n');
}

function countMdFiles(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  try {
    return fs.readdirSync(dirPath).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
  } catch {
    return 0;
  }
}

// ── updateReadmeIndex ─────────────────────────────────────────────────

export function updateReadmeIndex(dirPath: string, noun: string = 'note'): void {
  const readmePath = path.join(dirPath, 'README.md');

  let existing = '';
  if (fs.existsSync(readmePath)) {
    existing = fs.readFileSync(readmePath, 'utf8');
  }

  const newBlock = buildIndexBlock(dirPath, noun);

  const startIdx = existing.indexOf(INDEX_START);
  const endIdx = existing.indexOf(INDEX_END);

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace between markers (inclusive)
    updated =
      existing.slice(0, startIdx) +
      newBlock +
      existing.slice(endIdx + INDEX_END.length);
  } else if (existing.trim()) {
    // Append to existing prose
    updated = existing.trimEnd() + '\n\n' + newBlock + '\n';
  } else {
    updated = newBlock + '\n';
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(readmePath, updated, 'utf8');
}

// ── regenerateReadmeChain ─────────────────────────────────────────────

/**
 * Walk up from the file's directory regenerating README indexes at each level,
 * stopping at and including `workspaceRoot`. Never writes above the workspace
 * root so a badly-placed file cannot pollute parent directories.
 */
export function regenerateReadmeChain(filePath: string, workspaceRoot: string): void {
  let dir = path.dirname(filePath);
  const visited = new Set<string>();

  while (true) {
    if (visited.has(dir)) break;
    visited.add(dir);

    if (fs.existsSync(dir)) {
      updateReadmeIndex(dir);
    }

    // Stop after processing the workspace root — never go above it.
    if (dir === workspaceRoot) break;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root guard

    // Stay within workspace bounds.
    if (!parent.startsWith(workspaceRoot + path.sep) && parent !== workspaceRoot) break;

    dir = parent;
  }
}

// ── regenerateSystemReadmes ───────────────────────────────────────────

/**
 * Regenerate the README index for the `system/` collection and its two
 * standard subdirectories. Unlike memory, system docs are written by skills
 * (not through a server write path), so this is driven by the reindex flow.
 * Uses the `doc` noun and sorts each index by the `order` frontmatter field.
 */
export function regenerateSystemReadmes(workspaceDir: string): void {
  const systemDir = path.join(workspaceDir, 'system');
  if (!fs.existsSync(systemDir)) return;

  updateReadmeIndex(systemDir, 'doc');
  for (const subdir of ['features', 'technical']) {
    const dir = path.join(systemDir, subdir);
    if (fs.existsSync(dir)) updateReadmeIndex(dir, 'doc');
  }
}
