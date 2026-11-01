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
  return sessions.filter(
    (s) => s.workspaceSlug === workspaceSlug && s.projectSlug === projectSlug,
  );
}

export function groupTerminalsByLane(
  sessions: SessionListItem[],
): Record<TerminalLane, SessionListItem[]> {
  const lanes: Record<TerminalLane, SessionListItem[]> = {
    backlog: [],
    idle: [],
    active: [],
    waiting: [],
    done: [],
  };
  for (const session of sessions) {
    lanes[terminalLaneOf(session)].push(session);
  }
  return lanes;
}
