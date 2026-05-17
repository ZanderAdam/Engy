import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getEngyDir } from '../db/client';
import { dispatchGitWorktreeList } from '../ws/server';
import type { AppState } from '../trpc/context';

const BRANCH_SAFE_RE = /^[A-Za-z0-9._/-]+$/;

function validateSlug(slug: string): void {
  if (!slug || /[\/\\]/.test(slug) || slug.includes('..') || slug === '.') {
    throw new Error(`Invalid workspace slug: ${slug}`);
  }
}

export function getWorkspaceDir(workspace: { slug: string; docsDir: string | null }): string {
  return workspace.docsDir ?? path.join(getEngyDir(), workspace.slug);
}

export function resolveProjectDir(
  workspace: { slug: string; docsDir: string | null },
  project: { projectDir: string | null; slug: string },
): string {
  const slug = project.projectDir ?? project.slug;
  return path.join(getWorkspaceDir(workspace), 'projects', slug);
}

interface WorkspaceSkills {
  planSkill?: string | null;
  implementSkill?: string | null;
}

export function writeWorkspaceYaml(
  dir: string,
  name: string,
  slug: string,
  repos: string[],
  docsDir?: string | null,
  skills?: WorkspaceSkills,
): void {
  const config: Record<string, unknown> = { name, slug, repos: repos.map((r) => ({ path: r })) };
  if (docsDir) config.docsDir = docsDir;
  if (skills?.planSkill) config.planSkill = skills.planSkill;
  if (skills?.implementSkill) config.implementSkill = skills.implementSkill;
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), yaml.dump(config, { lineWidth: -1 }));
}

export function initWorkspaceDir(
  name: string,
  slug: string,
  repos: string[],
  docsDir?: string,
  skills?: WorkspaceSkills,
): void {
  validateSlug(slug);

  const dir = docsDir ?? path.join(getEngyDir(), slug);
  fs.mkdirSync(dir, { recursive: true });

  writeWorkspaceYaml(dir, name, slug, repos, docsDir, skills);

  fs.mkdirSync(path.join(dir, 'system', 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'system', 'technical'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'system', 'overview.md'),
    `# ${name}\n\nWorkspace overview — edit this file to describe your project.\n`,
  );

  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
}

export function renameWorkspaceDir(oldSlug: string, newSlug: string): void {
  validateSlug(oldSlug);
  validateSlug(newSlug);

  const engyDir = path.resolve(getEngyDir());
  const oldDir = path.join(engyDir, oldSlug);
  const newDir = path.join(engyDir, newSlug);

  for (const [label, dir] of [['old', oldDir], ['new', newDir]] as const) {
    const rel = path.relative(engyDir, path.resolve(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected for ${label} slug`);
    }
  }

  if (!fs.existsSync(oldDir)) {
    throw new Error(`Workspace directory does not exist: ${oldDir}`);
  }
  if (fs.existsSync(newDir)) {
    throw new Error(`Target directory already exists: ${newDir}`);
  }

  fs.renameSync(oldDir, newDir);
}

/**
 * Normalize a branch name into a path-safe segment.
 * Replaces `/` with `-`; rejects any branch with chars outside [A-Za-z0-9._/-].
 */
export function branchToPathSegment(branch: string): string {
  if (!branch || !BRANCH_SAFE_RE.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  return branch.replace(/\//g, '-');
}

/**
 * Compute the on-disk worktree path for a (project, branch, repo) tuple.
 * Layout: `${workspaceDir}/worktrees/<projectSlug>/<branchSegment>/<repoBasename>`.
 */
export function getProjectWorktreeDir(
  workspace: { slug: string; docsDir: string | null },
  projectSlug: string,
  branch: string,
  repoPath: string,
): string {
  validateSlug(projectSlug);
  const branchSegment = branchToPathSegment(branch);
  const repoBasename = path.basename(path.resolve(repoPath));
  if (!repoBasename || repoBasename === '/' || repoBasename === '.') {
    throw new Error(`Invalid repo path: ${repoPath}`);
  }
  return path.join(
    getWorkspaceDir(workspace),
    'worktrees',
    projectSlug,
    branchSegment,
    repoBasename,
  );
}

/**
 * When `workspace.docsDir` lives inside one of `workspace.repos`, and that repo
 * has a worktree on `branch`, return the docs path rebased into the worktree.
 * Otherwise, return `workspace.docsDir` unchanged (or the default ENGY_DIR
 * computation if `docsDir` is null).
 *
 * Calls `dispatchGitWorktreeList` per candidate repo (the one that contains
 * `docsDir`). Errors from the daemon are swallowed and fall through to the
 * unchanged path — partial degradation, never throws.
 */
export async function effectiveDocsDirForBranch(
  workspace: { slug: string; docsDir: string | null; repos: unknown },
  branch: string,
  state: AppState,
): Promise<string> {
  const docsDir = workspace.docsDir;
  if (!docsDir) return getWorkspaceDir(workspace);
  const repos = (workspace.repos as string[] | null | undefined) ?? [];
  const normalizedDocs = path.resolve(docsDir);

  for (const repoPath of repos) {
    const normalizedRepo = path.resolve(repoPath);
    const isContained =
      normalizedDocs === normalizedRepo ||
      normalizedDocs.startsWith(normalizedRepo + path.sep);
    if (!isContained) continue;
    const rel = path.relative(normalizedRepo, normalizedDocs);
    // docsDir is inside repoPath — look up the worktree for `branch` in this repo.
    try {
      const { worktrees } = await dispatchGitWorktreeList(repoPath, state);
      const match = worktrees.find((w) => !w.isMain && w.branch === branch);
      if (match) return rel ? path.join(match.path, rel) : match.path;
    } catch {
      // Daemon failure — fall through to the unchanged docsDir.
    }
    // docsDir is inside this repo but no matching worktree — return unchanged
    // (docsDir can only sit inside one repo, so don't check the rest).
    return docsDir;
  }

  return docsDir;
}

export function removeWorkspaceDir(slug: string, docsDir?: string | null): void {
  validateSlug(slug);

  let resolved: string;

  if (docsDir) {
    resolved = path.resolve(docsDir);
  } else {
    const engyDir = path.resolve(getEngyDir());
    const dir = path.join(engyDir, slug);
    resolved = path.resolve(dir);

    const rel = path.relative(engyDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected for slug: ${slug}`);
    }
  }

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
