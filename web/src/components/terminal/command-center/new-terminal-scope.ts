import type { TerminalScope } from '../types';
import type { TerminalWorktreeGroup } from '../worktree-grouping';

const TRAILING_ORDINAL_RE = /\s\(\d+\)$/;

/**
 * Build the scope for a new terminal in a Command Center project group by
 * cloning the group's first terminal that is not the orchestrator, so a new
 * terminal never copies the orchestrator's worktree or label. The trailing " (N)" ordinal is stripped so the
 * manager re-suffixes from the base label, and any task binding is dropped — a
 * cloned terminal is a plain project terminal, not a task terminal. Returns
 * null when the group has no terminals to clone from, or when the source is
 * not project-scoped — creation is deliberately limited to project groups
 * (FR-TERMINAL-190), so the "Other terminals" bucket never spawns clones.
 */
export function cloneScopeForNewTerminal(
  worktreeGroups: TerminalWorktreeGroup[],
): TerminalScope | null {
  const tabs = worktreeGroups.flatMap((group) => group.tabs);
  const source = tabs.find((tab) => !tab.orchestrator) ?? tabs[0];
  if (!source?.scope.projectSlug) return null;

  return {
    ...source.scope,
    scopeLabel: source.scope.scopeLabel.replace(TRAILING_ORDINAL_RE, ''),
    taskId: undefined,
  };
}
