import type { TerminalScope } from '../types';
import type { TerminalWorktreeGroup } from '../worktree-grouping';

const TRAILING_ORDINAL_RE = /\s\(\d+\)$/;

/**
 * Build the scope for a new terminal in a Command Center project group by
 * cloning the group's first terminal (default branch sorts first, so that's the
 * most representative source). The trailing " (N)" ordinal is stripped so the
 * manager re-suffixes from the base label, and any task binding is dropped — a
 * cloned terminal is a plain project terminal, not a task terminal. Returns
 * null when the group has no terminals to clone from, or when the source is
 * not project-scoped — creation is deliberately limited to project groups
 * (FR-TERMINAL-170), so the "Other terminals" bucket never spawns clones.
 */
export function cloneScopeForNewTerminal(
  worktreeGroups: TerminalWorktreeGroup[],
): TerminalScope | null {
  const source = worktreeGroups[0]?.tabs[0];
  if (!source?.scope.projectSlug) return null;

  return {
    ...source.scope,
    scopeLabel: source.scope.scopeLabel.replace(TRAILING_ORDINAL_RE, ''),
    taskId: undefined,
  };
}
