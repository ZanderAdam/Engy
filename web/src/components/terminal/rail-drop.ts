import { projectKey } from './command-center/grouping';
import type { TerminalRailGroupItem } from './rail-order';
import type { TerminalRailGroup, TerminalTab } from './types';

export type RailDropZone = 'before' | 'into' | 'after';

type ReorderPosition = 'before' | 'after';

export interface RailDropPlan {
  reorder?: { targetSessionId: string; position: ReorderPosition };
  regroup?: { sessionIds: string[]; group: TerminalRailGroup | null };
}

interface RailDropOptions {
  byWorktree: boolean;
  newGroup: () => TerminalRailGroup;
}

const EDGE_FRACTION = 0.25;

export function railDropZone(offsetY: number, height: number): RailDropZone {
  const edge = height * EDGE_FRACTION;
  if (offsetY < edge) return 'before';
  if (offsetY > height - edge) return 'after';
  return 'into';
}

/** Groups nest inside the rail's worktree (and Command Center project) sections. */
function sameSection(a: TerminalTab, b: TerminalTab, byWorktree: boolean): boolean {
  if (projectKey(a.scope) !== projectKey(b.scope)) return false;
  return !byWorktree || a.scope.worktreeBranch === b.scope.worktreeBranch;
}

function regroupIfChanged(
  dragged: TerminalTab,
  group: TerminalRailGroup | null,
): RailDropPlan['regroup'] {
  if ((dragged.railGroup?.id ?? null) === (group?.id ?? null)) return undefined;
  return { sessionIds: [dragged.sessionId], group };
}

function reorder(
  dragged: TerminalTab,
  target: TerminalTab,
  position: ReorderPosition,
): RailDropPlan['reorder'] {
  if (dragged.sessionId === target.sessionId) return undefined;
  return { targetSessionId: target.sessionId, position };
}

/**
 * A terminal dropped on another terminal's row. An edge drop sorts and takes
 * the target's group (so dropping beside an ungrouped terminal leaves a group);
 * a middle drop joins the target's group or makes a new one with it.
 */
export function planTerminalDrop(
  dragged: TerminalTab,
  target: TerminalTab,
  zone: RailDropZone,
  options: RailDropOptions,
): RailDropPlan {
  const joinable = sameSection(dragged, target, options.byWorktree);

  if (zone === 'into' && joinable && !target.railGroup) {
    return {
      reorder: reorder(dragged, target, 'after'),
      regroup: { sessionIds: [target.sessionId, dragged.sessionId], group: options.newGroup() },
    };
  }

  const position: ReorderPosition = zone === 'before' ? 'before' : 'after';
  return {
    reorder: reorder(dragged, target, position),
    regroup: joinable ? regroupIfChanged(dragged, target.railGroup ?? null) : undefined,
  };
}

export function planGroupHeaderDrop(
  dragged: TerminalTab,
  group: TerminalRailGroupItem,
  zone: RailDropZone,
  options: Pick<RailDropOptions, 'byWorktree'>,
): RailDropPlan {
  const first = group.tabs[0];
  const last = group.tabs[group.tabs.length - 1];
  if (!sameSection(dragged, first, options.byWorktree)) return {};

  if (zone === 'before') {
    return { reorder: reorder(dragged, first, 'before'), regroup: regroupIfChanged(dragged, null) };
  }
  return {
    reorder: reorder(dragged, last, 'after'),
    regroup: regroupIfChanged(dragged, group.group),
  };
}
