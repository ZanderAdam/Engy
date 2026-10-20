import type { TerminalTab } from './types';

/**
 * Order the manager's tabs the way the dock shows them, so the rail list and
 * the dock tab strip agree — including after a drag reorders either one. Tabs
 * with no panel yet (added to the map a tick before dockview mounts them) keep
 * their insertion order at the end rather than disappearing.
 */
export function orderTabsByPanelIds(
  panelIds: string[],
  tabs: Map<string, TerminalTab>,
): TerminalTab[] {
  const ordered: TerminalTab[] = [];
  const placed = new Set<string>();

  for (const id of panelIds) {
    const tab = tabs.get(id);
    if (!tab) continue;
    ordered.push(tab);
    placed.add(id);
  }
  for (const [id, tab] of tabs) {
    if (!placed.has(id)) ordered.push(tab);
  }

  return ordered;
}

/**
 * Where to insert a moving panel so it lands before or after the target. The
 * index is counted without the moving panel, because dockview removes the panel
 * before it re-inserts it.
 */
export function reorderIndex(
  panelIds: string[],
  movingId: string,
  targetId: string,
  position: 'before' | 'after',
): number {
  const others = panelIds.filter((id) => id !== movingId);
  return others.indexOf(targetId) + (position === 'after' ? 1 : 0);
}
