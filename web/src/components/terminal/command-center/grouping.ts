import type { TerminalScope, TerminalTab } from '../types';
import { groupTabsByWorktree, type TerminalWorktreeGroup } from '../worktree-grouping';

interface CommandCenterProjectGroup {
  /** Stable identity for React keys and selection. */
  key: string;
  /** Display label — project slug, or a workspace/other fallback. */
  label: string;
  /** False for the "Other terminals" catch-all (workspace/dir-scoped sessions). */
  isProject: boolean;
  /** Optional workspace slug shown as a secondary line when present. */
  workspaceSlug?: string;
  /** Terminals grouped by worktree branch within this project. */
  worktreeGroups: TerminalWorktreeGroup[];
  /** Total terminals across all worktree groups. */
  count: number;
}

const OTHER_KEY = '__other__';

function projectKey(scope: TerminalScope): string {
  return scope.projectSlug ? `p:${scope.workspaceSlug}/${scope.projectSlug}` : OTHER_KEY;
}

function projectLabel(scope: TerminalScope): string {
  return scope.projectSlug ?? 'Other terminals';
}

/**
 * Group global terminal tabs into a two-level tree: project → worktree branch.
 * Projects keep first-seen order so the list stays stable as terminals open and
 * close; the catch-all "Other terminals" bucket (workspace/dir-scoped sessions
 * with no project) always sorts last. Worktree grouping within each project
 * reuses the rail's convention (default branch first).
 */
export function groupTabsByProject(tabs: TerminalTab[]): CommandCenterProjectGroup[] {
  const byProject = new Map<string, TerminalTab[]>();

  for (const tab of tabs) {
    const key = projectKey(tab.scope);
    let bucket = byProject.get(key);
    if (!bucket) {
      bucket = [];
      byProject.set(key, bucket);
    }
    bucket.push(tab);
  }

  // Map maintains insertion order — first-seen project order is preserved.
  const groups = Array.from(byProject.entries()).map(([key, bucket]) => ({
    key,
    label: projectLabel(bucket[0].scope),
    isProject: key !== OTHER_KEY,
    workspaceSlug: bucket[0].scope.projectSlug ? bucket[0].scope.workspaceSlug : undefined,
    worktreeGroups: groupTabsByWorktree(bucket),
    count: bucket.length,
  } satisfies CommandCenterProjectGroup));

  groups.sort((a, b) => {
    if (a.key === OTHER_KEY) return 1;
    if (b.key === OTHER_KEY) return -1;
    return 0;
  });

  return groups;
}
