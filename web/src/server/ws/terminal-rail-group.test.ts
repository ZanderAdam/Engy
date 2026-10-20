import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { handleTerminalRailGroupRequest } from './terminal-rail-group';
import { listTerminalSessions } from './terminal-session-list';
import { loadPersistedTerminalSessions, persistTerminalSession } from './terminal-session-store';

function meta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'claude: web',
    workingDir: '/repo/web',
    groupKey: 'project:ws:alpha',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

const GROUP = { id: 'g1', name: 'Reviews' };

describe('terminal relay', () => {
  describe('rail groups', () => {
    let ctx: TestContext;
    let state: AppState;

    beforeEach(() => {
      ctx = setupTestDb();
      state = ctx.state;
      for (const id of ['s1', 's2']) {
        state.terminalSessionMeta.set(id, meta());
        persistTerminalSession(id, meta());
      }
    });

    afterEach(() => {
      ctx.cleanup();
    });

    function listedGroups(): Record<string, unknown> {
      const sessions = listTerminalSessions(state, {
        all: true,
        groupKey: null,
        scopeType: '',
        scopeLabel: '',
      });
      return Object.fromEntries(sessions.map((s) => [s.sessionId, s.railGroup]));
    }

    it('[FR-TERMINAL-1020] should put sessions into a group and list them with it', () => {
      const res = handleTerminalRailGroupRequest(state, { sessionIds: ['s1', 's2'], group: GROUP });

      expect(res).toEqual({ status: 200, body: { ok: true, updated: ['s1', 's2'] } });
      expect(listedGroups()).toEqual({ s1: GROUP, s2: GROUP });
    });

    it('[FR-TERMINAL-1020] should broadcast a regrouped change for each session', () => {
      const events: unknown[] = [];
      const listener = {
        readyState: 1,
        send: (data: string) => events.push(JSON.parse(data)),
      } as unknown as WebSocket;
      state.fileChangeListeners.add(listener);

      handleTerminalRailGroupRequest(state, { sessionIds: ['s1', 's2'], group: GROUP });

      expect(events).toEqual(
        ['s1', 's2'].map((sessionId) => ({
          type: 'TERMINAL_SESSIONS_CHANGE',
          payload: {
            action: 'regrouped',
            sessionId,
            groupKey: 'project:ws:alpha',
            railGroup: GROUP,
          },
        })),
      );
    });

    it('[FR-TERMINAL-1020] should keep the group across a server restart', () => {
      handleTerminalRailGroupRequest(state, { sessionIds: ['s1'], group: GROUP });
      state.terminalSessionMeta.clear();

      loadPersistedTerminalSessions(state);

      expect(state.terminalSessionMeta.get('s1')?.railGroup).toEqual(GROUP);
    });

    it('[FR-TERMINAL-1020] should take a session out of its group when group is null', () => {
      handleTerminalRailGroupRequest(state, { sessionIds: ['s1', 's2'], group: GROUP });

      handleTerminalRailGroupRequest(state, { sessionIds: ['s1'], group: null });

      expect(listedGroups()).toEqual({ s1: undefined, s2: GROUP });
    });

    it('[FR-TERMINAL-1020] should trim the group name', () => {
      handleTerminalRailGroupRequest(state, {
        sessionIds: ['s1'],
        group: { id: 'g1', name: '  Ops  ' },
      });

      expect(state.terminalSessionMeta.get('s1')?.railGroup).toEqual({ id: 'g1', name: 'Ops' });
    });

    it('should skip unknown sessions and update the rest', () => {
      const res = handleTerminalRailGroupRequest(state, {
        sessionIds: ['gone', 's1'],
        group: GROUP,
      });

      expect(res.body).toEqual({ ok: true, updated: ['s1'] });
    });

    it('should return 404 when no session exists', () => {
      const res = handleTerminalRailGroupRequest(state, { sessionIds: ['gone'], group: GROUP });

      expect(res.status).toBe(404);
    });

    it.each([
      ['a non-object body', 'nope'],
      ['no session ids', { sessionIds: [], group: GROUP }],
      ['a non-string session id', { sessionIds: [1], group: GROUP }],
      ['a missing group', { sessionIds: ['s1'] }],
      ['a blank group name', { sessionIds: ['s1'], group: { id: 'g1', name: ' ' } }],
      ['a missing group id', { sessionIds: ['s1'], group: { name: 'x' } }],
    ])('should reject %s with 400', (_label, body) => {
      const res = handleTerminalRailGroupRequest(state, body);

      expect(res.status).toBe(400);
      expect(state.terminalSessionMeta.get('s1')?.railGroup).toBeUndefined();
    });
  });
});
