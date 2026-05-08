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

// ── Index generation ─────────────────────────────────────────────────

function buildIndexBlock(dirPath: string): string {
  if (!fs.existsSync(dirPath)) return `${INDEX_START}\n${INDEX_END}`;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => e.name)
    .sort();

  const lines: string[] = [INDEX_START];

  if (subdirs.length > 0 && files.length > 0) {
    // Mixed dir: emit both sections
    lines.push('');
    lines.push('**Sections**');
    lines.push('');
    for (const subdir of subdirs) {
      const readmePath = path.join(dirPath, subdir, 'README.md');
      const desc = extractDescription(readmePath);
      const fileCount = countMdFiles(path.join(dirPath, subdir));
      const countStr = fileCount > 0 ? ` (${fileCount} notes)` : '';
      lines.push(`- [${escapeTocEntry(subdir)}](${subdir}/) — ${escapeTocEntry(desc)}${countStr}`);
    }
    lines.push('');
    lines.push('**Notes**');
    lines.push('');
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const desc = extractDescription(filePath);
      lines.push(`- [${escapeTocEntry(file)}](${file}) — ${escapeTocEntry(desc)}`);
    }
  } else if (subdirs.length > 0) {
    // Subdirs only
    lines.push('');
    for (const subdir of subdirs) {
      const readmePath = path.join(dirPath, subdir, 'README.md');
      const desc = extractDescription(readmePath);
      const fileCount = countMdFiles(path.join(dirPath, subdir));
      const countStr = fileCount > 0 ? ` (${fileCount} notes)` : '';
      lines.push(`- [${escapeTocEntry(subdir)}](${subdir}/) — ${escapeTocEntry(desc)}${countStr}`);
    }
  } else if (files.length > 0) {
    // Files only
    lines.push('');
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const desc = extractDescription(filePath);
      lines.push(`- [${escapeTocEntry(file)}](${file}) — ${escapeTocEntry(desc)}`);
    }
  } else {
    // Empty
    lines.push('');
    lines.push('- (empty)');
  }

  lines.push('');
  lines.push(INDEX_END);
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

export function updateReadmeIndex(dirPath: string): void {
  const readmePath = path.join(dirPath, 'README.md');

  let existing = '';
  if (fs.existsSync(readmePath)) {
    existing = fs.readFileSync(readmePath, 'utf8');
  }

  const newBlock = buildIndexBlock(dirPath);

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

export function regenerateReadmeChain(filePath: string): void {
  // Walk up from the file's directory, regenerating READMEs at each level.
  // M7 supports one level of subdirs under collection roots — we walk up
  // until we hit the workspace dir (two levels up from collection root).
  let dir = path.dirname(filePath);
  const visited = new Set<string>();

  // Walk up at most 4 levels (file → subtype dir → memory → workspace root)
  for (let i = 0; i < 4; i++) {
    if (visited.has(dir)) break;
    visited.add(dir);

    // Only update if a README exists or there are markdown files here
    if (fs.existsSync(dir)) {
      updateReadmeIndex(dir);
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
}
