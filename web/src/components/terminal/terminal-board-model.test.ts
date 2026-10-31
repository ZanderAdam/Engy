import { describe, expect, it } from 'vitest';
import type { SessionListItem } from './session-to-tab';
import {
  groupTerminalsByLane,
  projectTerminals,
  terminalLaneOf,
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
  });
});
