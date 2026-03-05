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
} from '../spec/frontmatter';

interface ProjectFileTreeNode {
  name: string;
  type: SpecType | null;
  status: SpecStatus | null;
  files: string[];
}

interface ProjectFileContent {
  frontmatter: SpecFrontmatter;
  body: string;
  files: string[];
  raw: Record<string, unknown>;
}

type Workspace = { slug: string; docsDir: string | null };

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

function projectsDir(workspace: Workspace): string {
  return path.join(getWorkspaceDir(workspace), 'projects');
}

function validatePath(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${target}`);
  }
  return resolved;
}

function collectMarkdownFiles(projectDir: string): string[] {
  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  const files: string[] = [];

  for (const f of entries) {
    if (f.isFile() && f.name.endsWith('.md')) files.push(f.name);
    if (f.isDirectory()) {
      const subFiles = fs.readdirSync(path.join(projectDir, f.name));
      for (const sf of subFiles) {
        if (sf.endsWith('.md')) files.push(`${f.name}/${sf}`);
      }
    }
  }

  return files.sort();
}

export function listProjectFiles(workspace: Workspace, projectDir: string): ProjectFileTreeNode {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectDir);
  const files = fs.existsSync(projDir) ? collectMarkdownFiles(projDir) : [];

  let type: SpecType | null = null;
  let status: SpecStatus | null = null;
  const specMdPath = path.join(projDir, 'spec.md');
  if (fs.existsSync(specMdPath)) {
    try {
      const { frontmatter } = parseFrontmatter(fs.readFileSync(specMdPath, 'utf-8'));
      type = frontmatter.type;
      status = frontmatter.status;
    } catch {
      // No valid frontmatter — still show the directory
    }
  }

  return { name: projectDir, type, status, files };
}

export function initProjectDir(workspace: Workspace, slug: string): void {
  const dir = projectsDir(workspace);
  fs.mkdirSync(dir, { recursive: true });

  const projDir = path.join(dir, slug);
  fs.mkdirSync(projDir, { recursive: true });

  const frontmatter: SpecFrontmatter = { title: slug, status: 'draft', type: 'buildable' };
  const body = `# ${slug}\n`;
  fs.writeFileSync(path.join(projDir, 'spec.md'), serializeFrontmatter(frontmatter, body));
}

export function removeProjectDir(workspace: Workspace, slug: string): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, slug);

  if (fs.existsSync(projDir)) {
    fs.rmSync(projDir, { recursive: true, force: true });
  }
}

export function getProjectSpec(workspace: Workspace, projectSlug: string): ProjectFileContent {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const specMdPath = path.join(projDir, 'spec.md');

  if (!fs.existsSync(specMdPath)) {
    throw new Error(`Project spec "${projectSlug}" not found`);
  }

  const content = fs.readFileSync(specMdPath, 'utf-8');
  const { frontmatter, body, raw } = parseFrontmatter(content);

  const files = collectMarkdownFiles(projDir);

  return { frontmatter, body, files, raw };
}

export function updateProjectSpec(
  workspace: Workspace,
  projectSlug: string,
  updates: { title?: string; status?: SpecStatus; body?: string },
): SpecFrontmatter {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const specMdPath = path.join(projDir, 'spec.md');

  if (!fs.existsSync(specMdPath)) {
    throw new Error(`Project spec "${projectSlug}" not found`);
  }

  const content = fs.readFileSync(specMdPath, 'utf-8');
  const { frontmatter, body, raw } = parseFrontmatter(content);

  if (updates.status && updates.status !== frontmatter.status) {
    validateStatusTransition(frontmatter.type, frontmatter.status, updates.status, projectSlug);
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

export function listProjectContextFiles(workspace: Workspace, projectSlug: string): string[] {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const contextDir = path.join(projDir, 'context');

  if (!fs.existsSync(contextDir)) return [];
  return fs.readdirSync(contextDir).sort();
}

export function readProjectContextFile(
  workspace: Workspace,
  projectSlug: string,
  filename: string,
): string {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const contextDir = path.join(projDir, 'context');
  const filePath = validatePath(contextDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Context file "${filename}" not found`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

export function writeProjectContextFile(
  workspace: Workspace,
  projectSlug: string,
  filename: string,
  content: string,
): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const contextDir = path.join(projDir, 'context');
  const filePath = validatePath(contextDir, filename);

  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function deleteProjectContextFile(
  workspace: Workspace,
  projectSlug: string,
  filename: string,
): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const contextDir = path.join(projDir, 'context');
  const filePath = validatePath(contextDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Context file "${filename}" not found`);
  }

  fs.unlinkSync(filePath);
}

export function readProjectFile(workspace: Workspace, projectSlug: string, filePath: string): string {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolved = validatePath(projDir, filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File "${filePath}" not found in project "${projectSlug}"`);
  }

  return fs.readFileSync(resolved, 'utf-8');
}

export function writeProjectFile(
  workspace: Workspace,
  projectSlug: string,
  filePath: string,
  content: string,
): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolved = validatePath(projDir, filePath);

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

export function checkProjectReadiness(projectSlug: string): boolean {
  const db = getDb();
  const projectTasks = db.select().from(tasks).where(eq(tasks.specId, projectSlug)).all();
  return projectTasks.length === 0 || projectTasks.every((t) => t.status === 'done');
}

// ── Internal helpers ─────────────────────────────────────────────

function validateStatusTransition(
  type: SpecType,
  current: SpecStatus,
  next: SpecStatus,
  projectSlug: string,
): void {
  const transitions = type === 'vision' ? VISION_TRANSITIONS : BUILDABLE_TRANSITIONS;
  const allowed = transitions[current] ?? [];

  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid status transition for ${type} spec: "${current}" → "${next}"`,
    );
  }

  if (type === 'buildable' && current === 'draft' && next === 'ready') {
    if (!checkProjectReadiness(projectSlug)) {
      throw new Error('Cannot mark spec as ready: incomplete tasks exist');
    }
  }
}
