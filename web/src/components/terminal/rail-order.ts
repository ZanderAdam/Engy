import { groupTabsByProject } from './command-center/grouping';
import type { TerminalRailGroup, TerminalTab } from './types';
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
  singleSectionKey = '__all__',
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
      key: singleSectionKey,
      projectLabel: undefined,
      isProject: false,
      workspaceSlug: undefined,
      worktreeGroups: groupTabsByWorktree(tabs, byWorktree),
    },
  ];
}

/**
 * Display order only. Section data keeps its natural order, because the
 * Command Center "New terminal" clones from the first group.
 */
export function orchestratorFirst(groups: TerminalWorktreeGroup[]): TerminalWorktreeGroup[] {
  const index = groups.findIndex((group) => group.tabs.some((tab) => tab.orchestrator));
  if (index === -1) return groups;
  return [groups[index], ...groups.slice(0, index), ...groups.slice(index + 1)];
}

/** Stopped sessions wait in the rail's Parked group, outside the rail's order. */
export function splitParkedTabs(tabs: TerminalTab[]): {
  liveTabs: TerminalTab[];
  parkedTabs: TerminalTab[];
} {
  return {
    liveTabs: tabs.filter((tab) => tab.status !== 'dormant'),
    parkedTabs: tabs.filter((tab) => tab.status === 'dormant'),
  };
}

export interface TerminalRailGroupItem {
  kind: 'group';
  group: TerminalRailGroup;
  tabs: TerminalTab[];
}

type TerminalRailItem = { kind: 'terminal'; tab: TerminalTab } | TerminalRailGroupItem;

/**
 * Gather a worktree group's terminals into the user's rail groups. A group sits
 * where its first member is in dock order and holds its members in dock order,
 * so the dock stays the only source of order. The orchestrator is the exception:
 * it always leads, outside any user group.
 */
export function railItems(tabs: TerminalTab[]): TerminalRailItem[] {
  const items: TerminalRailItem[] = [];
  const groups = new Map<string, TerminalRailGroupItem>();
  for (const tab of tabs) {
    if (tab.orchestrator) {
      items.unshift({ kind: 'terminal', tab });
      continue;
    }
    if (!tab.railGroup) {
      items.push({ kind: 'terminal', tab });
      continue;
    }
    const existing = groups.get(tab.railGroup.id);
    if (existing) {
      existing.tabs.push(tab);
      continue;
    }
    const item: TerminalRailGroupItem = { kind: 'group', group: tab.railGroup, tabs: [tab] };
    groups.set(tab.railGroup.id, item);
    items.push(item);
  }
  return items;
}

/** The terminals the rail shows, top to bottom; members of a collapsed group are hidden. */
export function railOrder(
  sections: TerminalRailSection[],
  collapsedGroupIds: readonly string[],
): TerminalTab[] {
  const shownTabs = (item: TerminalRailItem): TerminalTab[] => {
    if (item.kind === 'terminal') return [item.tab];
    return collapsedGroupIds.includes(item.group.id) ? [] : item.tabs;
  };
  return sections.flatMap((section) =>
    orchestratorFirst(section.worktreeGroups).flatMap((group) =>
      railItems(group.tabs).flatMap(shownTabs),
    ),
  );
}
