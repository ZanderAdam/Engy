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

interface FileEntry {
  path: string;
  mtime: number;
}

interface ProjectFileTreeNode {
  name: string;
  type: SpecType | null;
  status: SpecStatus | null;
  files: FileEntry[];
  dirs: string[];
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

const MAX_PROJECT_DEPTH = 5;

function collectMarkdownFilesAndDirs(
  rootDir: string,
  currentDir: string,
  depth: number,
): { files: FileEntry[]; dirs: string[] } {
  if (depth <= 0) return { files: [], dirs: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return { files: [], dirs: [] };
  }

  const files: FileEntry[] = [];
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: path.relative(rootDir, fullPath), mtime: stat.mtimeMs });
      } catch {
        // file may have been deleted between readdir and stat
      }
    } else if (entry.isDirectory()) {
      const sub = collectMarkdownFilesAndDirs(rootDir, fullPath, depth - 1);
      files.push(...sub.files);
      dirs.push(...sub.dirs);
      if (sub.files.length === 0) {
        dirs.push(path.relative(rootDir, fullPath));
      }
    }
  }
  return { files, dirs };
}

export function listProjectFiles(workspace: Workspace, projectDir: string): ProjectFileTreeNode {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectDir);
  const result = fs.existsSync(projDir)
    ? collectMarkdownFilesAndDirs(projDir, projDir, MAX_PROJECT_DEPTH)
    : { files: [], dirs: [] };

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

  return {
    name: projectDir,
    type,
    status,
    files: result.files.sort((a, b) => a.path.localeCompare(b.path)),
    dirs: result.dirs.sort(),
  };
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

  const result = collectMarkdownFilesAndDirs(projDir, projDir, MAX_PROJECT_DEPTH);
  const files = result.files.map((f) => f.path);

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

export function mkdirProject(workspace: Workspace, projectSlug: string, subDir: string): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolved = validatePath(projDir, subDir);
  fs.mkdirSync(resolved, { recursive: true });
}

export function deleteProjectFile(workspace: Workspace, projectSlug: string, filePath: string): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolved = validatePath(projDir, filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File "${filePath}" not found in project "${projectSlug}"`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: "${filePath}"`);
  }

  fs.unlinkSync(resolved);
}

export function deleteProjectSubDir(workspace: Workspace, projectSlug: string, subDir: string): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolved = validatePath(projDir, subDir);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory "${subDir}" not found in project "${projectSlug}"`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: "${subDir}"`);
  }

  fs.rmSync(resolved, { recursive: true, force: true });
}

export function renameProjectFile(
  workspace: Workspace,
  projectSlug: string,
  oldPath: string,
  newPath: string,
): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolvedOld = validatePath(projDir, oldPath);
  const resolvedNew = validatePath(projDir, newPath);

  if (!fs.existsSync(resolvedOld)) {
    throw new Error(`File "${oldPath}" not found in project "${projectSlug}"`);
  }
  const stat = fs.statSync(resolvedOld);
  if (!stat.isFile()) {
    throw new Error(`Not a file: "${oldPath}"`);
  }
  if (fs.existsSync(resolvedNew)) {
    throw new Error(`File "${newPath}" already exists in project "${projectSlug}"`);
  }

  fs.mkdirSync(path.dirname(resolvedNew), { recursive: true });
  fs.renameSync(resolvedOld, resolvedNew);
}

export function renameProjectSubDir(
  workspace: Workspace,
  projectSlug: string,
  oldSubDir: string,
  newSubDir: string,
): void {
  const dir = projectsDir(workspace);
  const projDir = validatePath(dir, projectSlug);
  const resolvedOld = validatePath(projDir, oldSubDir);
  const resolvedNew = validatePath(projDir, newSubDir);

  if (!fs.existsSync(resolvedOld)) {
    throw new Error(`Directory "${oldSubDir}" not found in project "${projectSlug}"`);
  }
  const stat = fs.statSync(resolvedOld);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: "${oldSubDir}"`);
  }
  if (fs.existsSync(resolvedNew)) {
    throw new Error(`Directory "${newSubDir}" already exists in project "${projectSlug}"`);
  }

  fs.mkdirSync(path.dirname(resolvedNew), { recursive: true });
  fs.renameSync(resolvedOld, resolvedNew);
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
