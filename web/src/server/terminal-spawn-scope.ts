import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { projects, workspaces } from './db/schema';
import { getWorkspaceDir } from './engy-dir/init';
import { dispatchGitBranch } from './ws/server';
import { projectGroupKey, workspaceGroupKey } from '@/components/terminal/group-key';
import type { AppState } from './trpc/context';
import type { SpawnScope } from './terminal-dispatch';

type WorkspaceRow = typeof workspaces.$inferSelect;

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
 * `worktrees/` dir. Returns null when no workspace owns the directory.
 */
export async function resolveSpawnTarget(
  cwd: string,
  state: AppState,
): Promise<SpawnTarget | null> {
  const rows = getDb().select().from(workspaces).all();
  for (const workspace of rows) {
    const projectSlug = projectWorktreeSlug(workspace, cwd);
    const inRepo = workspaceRepos(workspace).some((repo) => isInside(cwd, repo));
    if (!projectSlug && !inRepo) continue;

    const project = projectSlug
      ? getDb()
          .select()
          .from(projects)
          .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, projectSlug)))
          .get()
      : undefined;
    if (!project) {
      return {
        workspace,
        scope: {
          scopeType: 'workspace',
          groupKey: workspaceGroupKey(workspace.slug),
          workspaceSlug: workspace.slug,
        },
      };
    }

    const worktreeBranch = await readBranch(cwd, state);
    return {
      workspace,
      scope: {
        scopeType: 'project',
        groupKey: projectGroupKey(workspace.slug, project.slug, worktreeBranch),
        workspaceSlug: workspace.slug,
        projectId: project.id,
        projectSlug: project.slug,
        worktreeBranch,
      },
    };
  }
  return null;
}
