import fs from 'node:fs';
import path from 'node:path';
import {
  PLANS_DIR,
  isPlanFile,
  planFilePathFromStem,
  planStemFromFilename,
  taskIdFromStem,
} from '../../lib/plan-naming';

function validatePath(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${target}`);
  }
  return resolved;
}

/**
 * Every task plan in a project, keyed by task id. Filenames carry an
 * agent-chosen description, so plans are discovered here rather than computed
 * anywhere else; when a replan leaves two files behind, the most recently
 * written one wins.
 */
export function readTaskPlans(
  projectDir: string,
  workspaceSlug: string,
): Record<number, string> {
  const plansDir = validatePath(projectDir, PLANS_DIR);
  if (!fs.existsSync(plansDir)) return {};

  const newestFirst = fs
    .readdirSync(plansDir)
    .filter(isPlanFile)
    .map((f) => ({ f, mtime: fs.statSync(path.join(plansDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || a.f.localeCompare(b.f));

  const plans: Record<number, string> = {};
  for (const { f } of newestFirst) {
    const taskId = taskIdFromStem(planStemFromFilename(f), workspaceSlug);
    if (taskId !== null && !(taskId in plans)) {
      plans[taskId] = planFilePathFromStem(planStemFromFilename(f));
    }
  }
  return plans;
}

export function findTaskPlanPath(
  projectDir: string,
  workspaceSlug: string,
  taskId: number,
): string | null {
  return readTaskPlans(projectDir, workspaceSlug)[taskId] ?? null;
}

export function readTaskPlan(
  projectDir: string,
  workspaceSlug: string,
  taskId: number,
): string | null {
  const relPath = findTaskPlanPath(projectDir, workspaceSlug, taskId);
  if (!relPath) return null;
  return fs.readFileSync(validatePath(projectDir, relPath), 'utf-8');
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function milestoneFilename(sortOrder: number, title: string): string {
  return `m${sortOrder + 1}-${slugify(title)}.plan.md`;
}

export function writePlanFile(
  specsDir: string,
  specSlug: string,
  filename: string,
  content: string,
): void {
  const specDir = validatePath(specsDir, specSlug);
  const filePath = validatePath(specDir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function planFileExists(specsDir: string, specSlug: string, filename: string): boolean {
  const specDir = validatePath(specsDir, specSlug);
  const filePath = validatePath(specDir, filename);
  return fs.existsSync(filePath);
}

export function readPlanFile(
  specsDir: string,
  specSlug: string,
  filename: string,
): string | null {
  const specDir = validatePath(specsDir, specSlug);
  const filePath = validatePath(specDir, filename);

  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function listPlanFiles(specsDir: string, specSlug: string): string[] {
  const specDir = path.join(specsDir, specSlug);
  if (!fs.existsSync(specDir)) return [];

  return fs
    .readdirSync(specDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isPlanFile(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function deletePlanFile(
  specsDir: string,
  specSlug: string,
  filename: string,
): void {
  const specDir = validatePath(specsDir, specSlug);
  const filePath = validatePath(specDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Plan file "${filename}" not found`);
  }
  fs.unlinkSync(filePath);
}

// ── Milestone helpers ────────────────────────────────────────────────

export type MilestoneStatus = 'planned' | 'planning' | 'active' | 'complete';

const VALID_MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  'planned',
  'planning',
  'active',
  'complete',
];

type FilesystemMilestone = {
  ref: string;
  num: number;
  filename: string;
  title: string;
  status: MilestoneStatus;
  scope?: string;
};

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    // Strip surrounding double quotes (written by quoteFrontmatterValue).
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    result[key] = value;
  }
  return result;
}

function quoteFrontmatterValue(value: string): string {
  // Wrap in double quotes if the value contains characters that would break
  // the simple line-based parse (newlines, leading/trailing spaces, colons at start).
  // Newlines are replaced with spaces — they can't safely round-trip as-is.
  const normalized = value.replace(/\n+/g, ' ').trim();
  if (normalized.includes('"') || normalized.includes(':') || normalized !== value.trim()) {
    return `"${normalized.replace(/"/g, '\\"')}"`;
  }
  return normalized;
}

function normalizeMilestoneStatus(raw: string): MilestoneStatus {
  if ((VALID_MILESTONE_STATUSES as readonly string[]).includes(raw)) {
    return raw as MilestoneStatus;
  }
  console.warn(`[plan] unknown milestone status "${raw}", defaulting to "planned"`);
  return 'planned';
}

function parseMilestoneFilename(filename: string): { num: number } | null {
  const match = filename.match(/^m(\d+(?:\.\d+)?)-/);
  if (!match) return null;
  return { num: parseFloat(match[1]) };
}

export function buildMilestoneFrontmatter(
  title: string,
  status: MilestoneStatus,
  scope?: string,
): string {
  const lines = ['---', `title: ${quoteFrontmatterValue(title)}`, `status: ${status}`];
  if (scope) lines.push(`scope: ${quoteFrontmatterValue(scope)}`);
  lines.push('---\n');
  return lines.join('\n');
}

export function titleFromFilename(filename: string): string {
  return filename
    .replace(/^m[\d.]+-/, '')
    .replace(/\.plan\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function listMilestones(specsDir: string, specSlug: string): FilesystemMilestone[] {
  const files = listPlanFiles(specsDir, specSlug);
  const result: FilesystemMilestone[] = [];
  for (const filename of files) {
    const parsed = parseMilestoneFilename(filename);
    if (!parsed) continue;
    const content = readPlanFile(specsDir, specSlug, filename) ?? '';
    const fm = parseFrontmatter(content);
    result.push({
      ref: `m${parsed.num}`,
      num: parsed.num,
      filename,
      title: fm.title ?? titleFromFilename(filename),
      status: normalizeMilestoneStatus(fm.status ?? ''),
      scope: fm.scope || undefined,
    });
  }
  return result.sort((a, b) => a.num - b.num);
}

export function renamePlanFile(
  specsDir: string,
  specSlug: string,
  oldFilename: string,
  newFilename: string,
): void {
  const specDir = validatePath(specsDir, specSlug);
  const oldPath = validatePath(specDir, oldFilename);
  const newPath = validatePath(specDir, newFilename);

  if (!fs.existsSync(oldPath)) return;
  fs.renameSync(oldPath, newPath);
}
