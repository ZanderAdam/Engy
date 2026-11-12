import { describe, expect, it } from 'vitest';
import type { SessionListItem } from './session-to-tab';
import {
  groupTerminalsByLane,
  holdLanes,
  LANE_HOLD_MS,
  msUntilNextLaneChange,
  projectTerminals,
  shownLane,
  terminalLaneOf,
  type LaneHolds,
  type TerminalLane,
} from './terminal-board-model';

function session(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: 's1',
    scopeType: 'project',
    scopeLabel: 'project: initial',
    workingDir: '/repo',
    workspaceSlug: 'engy',
    projectSlug: 'initial',
    activityState: 'idle',
    status: 'active',
    browserCount: 1,
    ...overrides,
  };
}

describe('terminal board model', () => {
  describe('terminalLaneOf', () => {
    it.each([
      ['idle', 'idle'],
      ['active', 'active'],
      ['waiting', 'waiting'],
      ['done', 'done'],
    ] as const)('[FR-TERMINAL-1040] should put a %s session in the %s lane', (state, lane) => {
      expect(terminalLaneOf(session({ activityState: state }))).toBe(lane);
    });

    it('[FR-TERMINAL-1040] should put a session with no state in the idle lane', () => {
      expect(terminalLaneOf(session({ activityState: undefined }))).toBe('idle');
    });

    it('[FR-TERMINAL-1040] should put a dormant session in backlog whatever its state', () => {
      expect(terminalLaneOf(session({ dormant: true, activityState: 'idle' }))).toBe('backlog');
      expect(terminalLaneOf(session({ dormant: true, activityState: 'done' }))).toBe('backlog');
    });
  });

  describe('projectTerminals', () => {
    it('[FR-TERMINAL-1030] should keep the sessions of every worktree of the project', () => {
      const sessions = [
        session({ sessionId: 'main' }),
        session({ sessionId: 'wt', worktreeBranch: 'feature' }),
      ];

      const ids = projectTerminals(sessions, 'engy', 'initial').map((s) => s.sessionId);

      expect(ids).toEqual(['main', 'wt']);
    });

    it('[FR-TERMINAL-1030] should drop sessions of other projects and scopes', () => {
      const sessions = [
        session({ sessionId: 'other', projectSlug: 'other' }),
        session({ sessionId: 'workspace', projectSlug: undefined }),
      ];

      expect(projectTerminals(sessions, 'engy', 'initial')).toEqual([]);
    });

    it('[FR-TERMINAL-1030] should drop a same-slug project of another workspace', () => {
      const sessions = [session({ workspaceSlug: 'other', projectSlug: 'default' })];

      expect(projectTerminals(sessions, 'engy', 'default')).toEqual([]);
    });
  });

  describe('groupTerminalsByLane', () => {
    it('[FR-TERMINAL-1040] should list each session in exactly one lane', () => {
      const lanes = groupTerminalsByLane([
        session({ sessionId: 'a', activityState: 'active' }),
        session({ sessionId: 'b', activityState: 'waiting' }),
        session({ sessionId: 'c', dormant: true }),
      ]);

      expect(lanes.active.map((s) => s.sessionId)).toEqual(['a']);
      expect(lanes.waiting.map((s) => s.sessionId)).toEqual(['b']);
      expect(lanes.backlog.map((s) => s.sessionId)).toEqual(['c']);
      expect(lanes.idle).toEqual([]);
      expect(lanes.done).toEqual([]);
    });

    it('[FR-TERMINAL-1170] should place sessions by the lane function it is given', () => {
      const lanes = groupTerminalsByLane([session({ activityState: 'active' })], () => 'done');

      expect(lanes.done.map((s) => s.sessionId)).toEqual(['s1']);
      expect(lanes.active).toEqual([]);
    });
  });

  describe('lane hold', () => {
    const working = session({ activityState: 'active' });
    const done = session({ activityState: 'done' });
    const waiting = session({ activityState: 'waiting' });

    function shownAfter(steps: [SessionListItem, number][]): TerminalLane {
      let holds: LaneHolds = {};
      let last = steps[0][0];
      for (const [s, at] of steps) {
        holds = holdLanes(holds, [s], at);
        last = s;
      }
      return shownLane(holds[last.sessionId], last);
    }

    it('[FR-TERMINAL-1170] should show a new session in its lane at once', () => {
      expect(shownAfter([[working, 0]])).toBe('active');
    });

    it('[FR-TERMINAL-1170] should keep the old lane until the new one holds for the hold time', () => {
      expect(
        shownAfter([
          [working, 0],
          [done, 1_000],
          [done, 1_000 + LANE_HOLD_MS - 1],
        ]),
      ).toBe('active');
      expect(
        shownAfter([
          [working, 0],
          [done, 1_000],
          [done, 1_000 + LANE_HOLD_MS],
        ]),
      ).toBe('done');
    });

    it('[FR-TERMINAL-1170] should not move a card whose state flips back inside the hold time', () => {
      expect(
        shownAfter([
          [working, 0],
          [done, 1_000],
          [working, 2_000],
          [working, 2_000 + LANE_HOLD_MS],
        ]),
      ).toBe('active');
    });

    it('[FR-TERMINAL-1170] should restart the hold when the pending lane changes', () => {
      const steps: [SessionListItem, number][] = [
        [working, 0],
        [done, 1_000],
        [waiting, 3_000],
      ];

      expect(shownAfter([...steps, [waiting, 1_000 + LANE_HOLD_MS]])).toBe('active');
      expect(shownAfter([...steps, [waiting, 3_000 + LANE_HOLD_MS]])).toBe('waiting');
    });

    it('[FR-TERMINAL-1170] should move a card to idle or backlog at once', () => {
      const idle = session({ activityState: 'idle' });
      const parked = session({ dormant: true });

      expect(
        shownAfter([
          [working, 0],
          [idle, 1],
        ]),
      ).toBe('idle');
      expect(
        shownAfter([
          [working, 0],
          [parked, 1],
        ]),
      ).toBe('backlog');
      expect(
        shownAfter([
          [parked, 0],
          [working, 1],
        ]),
      ).toBe('active');
    });

    it('[FR-TERMINAL-1170] should drop the hold of a removed session', () => {
      const holds = holdLanes({}, [working], 0);

      expect(holdLanes(holds, [], 1)).toEqual({});
    });

    it('[FR-TERMINAL-1170] should keep the same holds object when nothing changes', () => {
      const holds = holdLanes({}, [working], 0);

      expect(holdLanes(holds, [working], 10)).toBe(holds);
    });

    it('[FR-TERMINAL-1170] should keep the same holds object for a repeated session id', () => {
      const holds = holdLanes({}, [working, working], 0);

      expect(holdLanes(holds, [working, working], 10)).toBe(holds);
    });

    describe('msUntilNextLaneChange', () => {
      it('[FR-TERMINAL-1170] should return null when no move is pending', () => {
        expect(msUntilNextLaneChange(holdLanes({}, [working], 0), 0)).toBeNull();
      });

      it('[FR-TERMINAL-1170] should return the time left on the soonest pending move', () => {
        const holds = holdLanes(holdLanes({}, [working], 0), [done], 1_000);

        expect(msUntilNextLaneChange(holds, 2_000)).toBe(LANE_HOLD_MS - 1_000);
        expect(msUntilNextLaneChange(holds, 1_000 + LANE_HOLD_MS + 50)).toBe(0);
      });
    });
  });
});
