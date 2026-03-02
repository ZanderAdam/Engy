import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getWorkspaceDir } from '../engy-dir/init';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';
import {
  parseFrontmatter,
  serializeFrontmatter,
  type SpecFrontmatter,
  type SpecStatus,
  type SpecType,
} from './frontmatter';

interface SpecTreeNode {
  name: string;
  type: SpecType | null;
  status: SpecStatus | null;
  files: string[];
}

interface SpecContent {
  frontmatter: SpecFrontmatter;
  body: string;
  files: string[];
  raw: Record<string, unknown>;
}

type Workspace = { slug: string; docsDir: string | null };

const MAX_SLUG_LENGTH = 50;

const BUILDABLE_TRANSITIONS: Record<string, string[]> = {
  draft: ['ready'],
  ready: ['approved'],
  approved: ['active'],
  active: ['completed'],
  completed: [],
};

const VISION_TRANSITIONS: Record<string, string[]> = {
  draft: ['completed'],
  completed: [],
};

function specsDir(workspace: Workspace): string {
  return path.join(getWorkspaceDir(workspace), 'specs');
}

function validatePath(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${target}`);
  }
  return resolved;
}

export function listSpecs(workspace: Workspace): SpecTreeNode[] {
  const dir = specsDir(workspace);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: SpecTreeNode[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const specDir = path.join(dir, entry.name);
    const allFiles = fs.readdirSync(specDir, { withFileTypes: true });
    const files: string[] = [];

    for (const f of allFiles) {
      if (f.isFile() && f.name.endsWith('.md')) files.push(f.name);
      if (f.isDirectory()) {
        const subFiles = fs.readdirSync(path.join(specDir, f.name));
        for (const sf of subFiles) {
          if (sf.endsWith('.md')) files.push(`${f.name}/${sf}`);
        }
      }
    }

    let type: SpecType | null = null;
    let status: SpecStatus | null = null;
    const specMdPath = path.join(specDir, 'spec.md');
    if (fs.existsSync(specMdPath)) {
      try {
        const { frontmatter } = parseFrontmatter(fs.readFileSync(specMdPath, 'utf-8'));
        type = frontmatter.type;
        status = frontmatter.status;
      } catch {
        // No valid frontmatter — still show the directory
      }
    }

    results.push({ name: entry.name, type, status, files: files.sort() });
  }

  return results;
}

export function createSpec(
  workspace: Workspace,
  title: string,
  type: SpecType = 'buildable',
): SpecTreeNode {
  const dir = specsDir(workspace);
  fs.mkdirSync(dir, { recursive: true });

  let dirName: string;
  if (type === 'buildable') {
    const prefix = nextBuildablePrefix(dir);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, MAX_SLUG_LENGTH);
    dirName = `${prefix}_${slug}`;
  } else {
    dirName = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, MAX_SLUG_LENGTH);
  }

  const specDir = path.join(dir, dirName);
  fs.mkdirSync(specDir, { recursive: true });
  fs.mkdirSync(path.join(specDir, 'context'), { recursive: true });

  const frontmatter: SpecFrontmatter = { title, status: 'draft', type };
  const body = `# ${title}\n`;
  fs.writeFileSync(path.join(specDir, 'spec.md'), serializeFrontmatter(frontmatter, body));

  return { name: dirName, type, status: 'draft', files: [] };
}

export function getSpec(workspace: Workspace, specSlug: string): SpecContent {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const specMdPath = path.join(specDir, 'spec.md');

  if (!fs.existsSync(specMdPath)) {
    throw new Error(`Spec "${specSlug}" not found`);
  }

  const content = fs.readFileSync(specMdPath, 'utf-8');
  const { frontmatter, body, raw } = parseFrontmatter(content);

  const files: string[] = [];
  const specDirEntries = fs.readdirSync(specDir, { withFileTypes: true });
  for (const f of specDirEntries) {
    if (f.isFile() && f.name.endsWith('.md')) files.push(f.name);
    if (f.isDirectory()) {
      const subFiles = fs.readdirSync(path.join(specDir, f.name));
      for (const sf of subFiles) {
        if (sf.endsWith('.md')) files.push(`${f.name}/${sf}`);
      }
    }
  }

  return { frontmatter, body, files: files.sort(), raw };
}

export function updateSpec(
  workspace: Workspace,
  specSlug: string,
  updates: { title?: string; status?: SpecStatus; body?: string },
): SpecFrontmatter {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const specMdPath = path.join(specDir, 'spec.md');

  if (!fs.existsSync(specMdPath)) {
    throw new Error(`Spec "${specSlug}" not found`);
  }

  const content = fs.readFileSync(specMdPath, 'utf-8');
  const { frontmatter, body, raw } = parseFrontmatter(content);

  if (updates.status && updates.status !== frontmatter.status) {
    validateStatusTransition(frontmatter.type, frontmatter.status, updates.status, specSlug);
  }

  const newFrontmatter: SpecFrontmatter = {
    title: updates.title ?? frontmatter.title,
    status: updates.status ?? frontmatter.status,
    type: frontmatter.type,
  };

  const newBody = updates.body ?? body;
  fs.writeFileSync(specMdPath, serializeFrontmatter(newFrontmatter, newBody, raw));

  return newFrontmatter;
}

export function deleteSpec(workspace: Workspace, specSlug: string): void {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);

  if (!fs.existsSync(specDir)) {
    throw new Error(`Spec "${specSlug}" not found`);
  }

  // Delete tasks first (reversible), then filesystem (hard to reverse)
  const db = getDb();
  db.delete(tasks).where(eq(tasks.specId, specSlug)).run();

  try {
    fs.rmSync(specDir, { recursive: true, force: true });
  } catch (e) {
    // Compensating action: re-create tasks would be complex, but at least the
    // spec directory still exists so the user can retry deletion
    throw new Error(`Failed to remove spec directory: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function listContextFiles(workspace: Workspace, specSlug: string): string[] {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const contextDir = path.join(specDir, 'context');

  if (!fs.existsSync(contextDir)) return [];
  return fs.readdirSync(contextDir).sort();
}

export function readContextFile(workspace: Workspace, specSlug: string, filename: string): string {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const contextDir = path.join(specDir, 'context');
  const filePath = validatePath(contextDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Context file "${filename}" not found`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

export function writeContextFile(
  workspace: Workspace,
  specSlug: string,
  filename: string,
  content: string,
): void {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const contextDir = path.join(specDir, 'context');
  const filePath = validatePath(contextDir, filename);

  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function deleteContextFile(
  workspace: Workspace,
  specSlug: string,
  filename: string,
): void {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const contextDir = path.join(specDir, 'context');
  const filePath = validatePath(contextDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Context file "${filename}" not found`);
  }

  fs.unlinkSync(filePath);
}

export function readSpecFile(workspace: Workspace, specSlug: string, filePath: string): string {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const resolved = validatePath(specDir, filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File "${filePath}" not found in spec "${specSlug}"`);
  }

  return fs.readFileSync(resolved, 'utf-8');
}

export function writeSpecFile(
  workspace: Workspace,
  specSlug: string,
  filePath: string,
  content: string,
): void {
  const dir = specsDir(workspace);
  const specDir = validatePath(dir, specSlug);
  const resolved = validatePath(specDir, filePath);

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

export function checkSpecReadiness(specId: string): boolean {
  const db = getDb();
  const specTasks = db.select().from(tasks).where(eq(tasks.specId, specId)).all();
  // No tasks means ready — specs without tasks can still advance
  return specTasks.length === 0 || specTasks.every((t) => t.status === 'done');
}

// ── Internal helpers ─────────────────────────────────────────────

function nextBuildablePrefix(dir: string): number {
  if (!fs.existsSync(dir)) return 1;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let max = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)_/);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return max + 1;
}

function validateStatusTransition(
  type: SpecType,
  current: SpecStatus,
  next: SpecStatus,
  specSlug: string,
): void {
  const transitions = type === 'vision' ? VISION_TRANSITIONS : BUILDABLE_TRANSITIONS;
  const allowed = transitions[current] ?? [];

  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid status transition for ${type} spec: "${current}" → "${next}"`,
    );
  }

  // Readiness gate: draft → ready requires all tasks done
  if (type === 'buildable' && current === 'draft' && next === 'ready') {
    if (!checkSpecReadiness(specSlug)) {
      throw new Error('Cannot mark spec as ready: incomplete tasks exist');
    }
  }
}
