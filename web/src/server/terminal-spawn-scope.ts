import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { projects, workspaces } from './db/schema';
import { getWorkspaceDir } from './engy-dir/init';
import { dispatchGitBranch } from './ws/server';
import {
  parseGroupKey,
  projectGroupKey,
  workspaceGroupKey,
} from '@/components/terminal/group-key';
import type { AppState } from './trpc/context';
import type { ProjectIdentity, SpawnScope } from './terminal-dispatch';

type WorkspaceRow = typeof workspaces.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

interface SpawnTarget {
  workspace: WorkspaceRow;
  scope: SpawnScope;
}

export function isInside(cwd: string, root: string): boolean {
  const resolved = path.resolve(cwd);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

export function workspaceRepos(workspace: WorkspaceRow): string[] {
  return Array.isArray(workspace.repos) ? workspace.repos : [];
}

export function listAllWorkspaceRepos(): string[] {
  return getDb().select().from(workspaces).all().flatMap(workspaceRepos);
}

function projectWorktreeSlug(workspace: WorkspaceRow, cwd: string): string | undefined {
  const worktreesRoot = path.join(getWorkspaceDir(workspace), 'worktrees');
  if (!isInside(cwd, worktreesRoot)) return undefined;
  const [slug] = path.relative(path.resolve(worktreesRoot), path.resolve(cwd)).split(path.sep);
  return slug && slug !== '_review' ? slug : undefined;
}

export function findProject(workspace: WorkspaceRow, slug: string): ProjectRow | undefined {
  return getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, slug)))
    .get();
}

export function spawnScope(
  workspace: WorkspaceRow,
  project?: ProjectRow,
  worktreeBranch?: string,
): SpawnScope {
  if (!project) {
    return {
      scopeType: 'workspace',
      groupKey: workspaceGroupKey(workspace.slug),
      workspaceSlug: workspace.slug,
    };
  }
  return {
    scopeType: 'project',
    groupKey: projectGroupKey(workspace.slug, project.slug, worktreeBranch),
    workspaceSlug: workspace.slug,
    projectId: project.id,
    projectSlug: project.slug,
    worktreeBranch,
  };
}

async function readBranch(cwd: string, state: AppState): Promise<string | undefined> {
  try {
    const { branch } = await dispatchGitBranch(cwd, state);
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find the workspace and project a spawn `cwd` belongs to: a workspace repo
 * (worktrees under it included) or a project worktree under the workspace's
 * `worktrees/` dir. A repo path alone names no project, so it takes the
 * project of `home` when `home` is in the same workspace. Returns null when no
 * workspace owns the directory.
 */
export async function resolveSpawnTarget(
  cwd: string,
  state: AppState,
  home?: ProjectIdentity & { groupKey?: string },
): Promise<SpawnTarget | null> {
  const rows = getDb().select().from(workspaces).all();
  const isHome = (workspace: WorkspaceRow) => workspace.slug === home?.workspaceSlug;
  // Two workspaces can list one repo, and the home workspace must win that tie.
  const ordered = [...rows.filter(isHome), ...rows.filter((row) => !isHome(row))];
  for (const workspace of ordered) {
    const pathSlug = projectWorktreeSlug(workspace, cwd);
    const inRepo = workspaceRepos(workspace).some((repo) => isInside(cwd, repo));
    if (!pathSlug && !inRepo) continue;

    const inherited = isHome(workspace) ? home : undefined;
    const projectSlug = pathSlug ?? inherited?.projectSlug;
    const project = projectSlug ? findProject(workspace, projectSlug) : undefined;
    if (!project) return { workspace, scope: spawnScope(workspace) };

    // meta.worktreeBranch follows HEAD; only the group key names the home dock.
    const worktreeBranch = pathSlug
      ? await readBranch(cwd, state)
      : parseGroupKey(inherited?.groupKey ?? '')?.worktreeBranch;
    return { workspace, scope: spawnScope(workspace, project, worktreeBranch) };
  }
  return null;
}
