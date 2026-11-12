'use client';

import { useEffect, useState } from 'react';
import type { SessionListItem } from './session-to-tab';
import {
  holdLanes,
  msUntilNextLaneChange,
  shownLane,
  type LaneHolds,
  type TerminalLane,
} from './terminal-board-model';

export function useHeldTerminalLanes(
  sessions: SessionListItem[] | undefined,
): (session: SessionListItem) => TerminalLane {
  const [holds, setHolds] = useState<LaneHolds>({});

  useEffect(() => {
    if (!sessions) return;
    const now = performance.now();
    const holdsAreCurrent = holdLanes(holds, sessions, now) === holds;
    const delay = holdsAreCurrent ? msUntilNextLaneChange(holds, now) : 0;
    if (delay === null) return;
    const timer = setTimeout(
      () => setHolds((prev) => holdLanes(prev, sessions, performance.now())),
      delay,
    );
    return () => clearTimeout(timer);
  }, [sessions, holds]);

  return (session) => shownLane(holds[session.sessionId], session);
}
