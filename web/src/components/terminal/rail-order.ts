import { groupTabsByProject } from './command-center/grouping';
import type { TerminalTab } from './types';
import { groupTabsByWorktree, type TerminalWorktreeGroup } from './worktree-grouping';

export interface TerminalRailSection {
  key: string;
  projectLabel: string | undefined;
  isProject: boolean;
  workspaceSlug: string | undefined;
  worktreeGroups: TerminalWorktreeGroup[];
}

/**
 * The sections the terminal rail renders. Command Center mode lists terminals
 * from every project, so it groups by project → worktree; the per-project rail
 * has one section grouped by worktree.
 */
export function railSections(
  tabs: TerminalTab[],
  commandCenter: boolean,
  byWorktree: boolean,
): TerminalRailSection[] {
  if (commandCenter) {
    return groupTabsByProject(tabs, byWorktree).map((pg) => ({
      key: pg.key,
      projectLabel: pg.label,
      isProject: pg.isProject,
      workspaceSlug: pg.workspaceSlug,
      worktreeGroups: pg.worktreeGroups,
    }));
  }
  return [
    {
      key: '__all__',
      projectLabel: undefined,
      isProject: false,
      workspaceSlug: undefined,
      worktreeGroups: groupTabsByWorktree(tabs, byWorktree),
    },
  ];
}

/** The terminals top to bottom, exactly as the rail lists them. */
export function railOrder(sections: TerminalRailSection[]): TerminalTab[] {
  return sections.flatMap((section) => section.worktreeGroups.flatMap((group) => group.tabs));
}
