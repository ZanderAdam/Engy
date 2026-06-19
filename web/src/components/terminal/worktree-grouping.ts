import type { TerminalTab } from './types';

interface TerminalWorktreeGroup {
  /** Worktree branch, or undefined for the default branch. */
  branch: string | undefined;
  /** Display label — branch name, or "default branch". */
  label: string;
  tabs: TerminalTab[];
}

export const DEFAULT_WORKTREE_LABEL = 'default branch';

/**
 * Group terminal tabs by their worktree branch for combined-mode display. The
 * default branch (undefined) sorts first; remaining branches keep first-seen
 * order so the grouping is stable as tabs open and close.
 */
export function groupTabsByWorktree(tabs: TerminalTab[]): TerminalWorktreeGroup[] {
  const order: Array<string | undefined> = [];
  const byBranch = new Map<string | undefined, TerminalTab[]>();

  for (const tab of tabs) {
    const branch = tab.scope.worktreeBranch;
    let group = byBranch.get(branch);
    if (!group) {
      group = [];
      byBranch.set(branch, group);
      order.push(branch);
    }
    group.push(tab);
  }

  const groups: TerminalWorktreeGroup[] = [];
  if (byBranch.has(undefined)) {
    groups.push({ branch: undefined, label: DEFAULT_WORKTREE_LABEL, tabs: byBranch.get(undefined)! });
  }
  for (const branch of order) {
    if (branch === undefined) continue;
    groups.push({ branch, label: branch, tabs: byBranch.get(branch)! });
  }
  return groups;
}
