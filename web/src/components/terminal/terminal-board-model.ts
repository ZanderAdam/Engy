import type { SessionListItem } from './session-to-tab';

export const TERMINAL_LANES = ['backlog', 'idle', 'active', 'waiting', 'done'] as const;
export type TerminalLane = (typeof TERMINAL_LANES)[number];

export const TERMINAL_LANE_LABELS: Record<TerminalLane, string> = {
  backlog: 'Backlog',
  idle: 'Idle',
  active: 'Working',
  waiting: 'Waiting',
  done: 'Done',
};

export const TERMINAL_LANE_DOT_COLORS: Record<TerminalLane, string> = {
  backlog: 'bg-zinc-500',
  idle: 'bg-muted-foreground',
  active: 'bg-blue-500',
  waiting: 'bg-amber-400',
  done: 'bg-emerald-500',
};

export function terminalLaneOf(session: SessionListItem): TerminalLane {
  // A dormant session keeps activityState 'idle', so this check must come first.
  if (session.dormant) return 'backlog';
  return session.activityState ?? 'idle';
}

export function projectTerminals(
  sessions: SessionListItem[],
  workspaceSlug: string,
  projectSlug: string,
): SessionListItem[] {
  return sessions.filter((s) => s.workspaceSlug === workspaceSlug && s.projectSlug === projectSlug);
}

export function groupTerminalsByLane(
  sessions: SessionListItem[],
  laneOf: (session: SessionListItem) => TerminalLane = terminalLaneOf,
): Record<TerminalLane, SessionListItem[]> {
  const lanes: Record<TerminalLane, SessionListItem[]> = {
    backlog: [],
    idle: [],
    active: [],
    waiting: [],
    done: [],
  };
  for (const session of sessions) {
    lanes[laneOf(session)].push(session);
  }
  return lanes;
}

export const LANE_HOLD_MS = 5_000;

export interface LaneHold {
  shown: TerminalLane;
  pending: TerminalLane;
  since: number;
}

export type LaneHolds = Record<string, LaneHold>;

// Idle follows a user action (input or focus) and Backlog follows a park or restore,
// so the user expects those moves at once; only agent-driven moves are held.
function skipsHold(shown: TerminalLane, raw: TerminalLane): boolean {
  return raw === 'idle' || raw === 'backlog' || shown === 'backlog';
}

function settle(hold: LaneHold | undefined, lane: TerminalLane, now: number): LaneHold {
  if (hold && hold.shown === lane && hold.pending === lane) return hold;
  return { shown: lane, pending: lane, since: now };
}

function advanceHold(hold: LaneHold | undefined, raw: TerminalLane, now: number): LaneHold {
  if (!hold || raw === hold.shown || skipsHold(hold.shown, raw)) return settle(hold, raw, now);
  if (raw !== hold.pending) return { shown: hold.shown, pending: raw, since: now };
  if (now - hold.since >= LANE_HOLD_MS) return settle(hold, raw, now);
  return hold;
}

export function holdLanes(prev: LaneHolds, sessions: SessionListItem[], now: number): LaneHolds {
  let changed = false;
  const next: LaneHolds = {};
  for (const session of sessions) {
    const hold = advanceHold(prev[session.sessionId], terminalLaneOf(session), now);
    next[session.sessionId] = hold;
    if (hold !== prev[session.sessionId]) changed = true;
  }
  if (Object.keys(next).length !== Object.keys(prev).length) changed = true;
  return changed ? next : prev;
}

export function shownLane(hold: LaneHold | undefined, session: SessionListItem): TerminalLane {
  const raw = terminalLaneOf(session);
  if (!hold || skipsHold(hold.shown, raw)) return raw;
  return hold.shown;
}

export function msUntilNextLaneChange(holds: LaneHolds, now: number): number | null {
  let soonest: number | null = null;
  for (const hold of Object.values(holds)) {
    if (hold.pending === hold.shown) continue;
    const left = Math.max(0, hold.since + LANE_HOLD_MS - now);
    if (soonest === null || left < soonest) soonest = left;
  }
  return soonest;
}
