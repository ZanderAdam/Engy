import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { listTerminalSessions } from './terminal-session-list';
import type { AppState } from '../trpc/context';

type Meta = AppState['terminalSessionMeta'] extends Map<string, infer V> ? V : never;

function meta(overrides: Partial<Meta> = {}): Meta {
  return {
    scopeType: 'project',
    scopeLabel: 'claude: web',
    workingDir: '/repo/web',
    groupKey: 'project:ws:alpha',
    workspaceSlug: 'ws',
    projectSlug: 'alpha',
    worktreeBranch: undefined,
    activityState: 'idle',
    cols: 80,
    rows: 24,
    ...overrides,
  } as Meta;
}

function openWs(): WebSocket {
  return { readyState: 1 } as WebSocket; // 1 === WebSocket.OPEN
}

function makeState(
  metaEntries: Array<[string, Meta]>,
  sockets: Record<string, Set<WebSocket>> = {},
): Pick<AppState, 'terminalSessionMeta' | 'terminalSessions'> {
  return {
    terminalSessionMeta: new Map(metaEntries),
    terminalSessions: new Map(Object.entries(sockets)),
  } as Pick<AppState, 'terminalSessionMeta' | 'terminalSessions'>;
}

describe('terminal relay', () => {
  describe('listTerminalSessions', () => {
    it('[FR-TERMINAL-170] in all mode returns every session with project, worktree, and activity fields', () => {
      const state = makeState(
        [
          ['s1', meta({ projectSlug: 'alpha', worktreeBranch: 'feature-x', activityState: 'waiting' })],
          ['s2', meta({ projectSlug: 'beta', scopeLabel: 'shell' })],
        ],
        { s1: new Set([openWs()]) },
      );

      const result = listTerminalSessions(state, { all: true, groupKey: null, scopeType: '', scopeLabel: '' });

      expect(result.map((r) => r.sessionId).sort()).toEqual(['s1', 's2']);
      const s1 = result.find((r) => r.sessionId === 's1')!;
      expect(s1.projectSlug).toBe('alpha');
      expect(s1.worktreeBranch).toBe('feature-x');
      expect(s1.activityState).toBe('waiting');
      expect(s1.status).toBe('active'); // one open browser
      const s2 = result.find((r) => r.sessionId === 's2')!;
      expect(s2.status).toBe('suspended'); // no browser attached
      expect(s2.activityState).toBe('idle');
    });

    it('[FR-TERMINAL-520] reports the dormant marker so the client can offer a restore', () => {
      const state = makeState([
        ['s1', meta({ dormant: true })],
        ['s2', meta()],
      ]);

      const result = listTerminalSessions(state, { all: true, groupKey: null, scopeType: '', scopeLabel: '' });

      expect(result.find((r) => r.sessionId === 's1')!.dormant).toBe(true);
      expect(result.find((r) => r.sessionId === 's2')!.dormant).toBe(false);
    });

    it('[FR-TERMINAL-170] non-all mode filters by groupKey', () => {
      const state = makeState([
        ['s1', meta({ groupKey: 'gk-a' })],
        ['s2', meta({ groupKey: 'gk-b' })],
      ]);

      const result = listTerminalSessions(state, {
        all: false,
        groupKey: 'gk-a',
        scopeType: '',
        scopeLabel: '',
      });

      expect(result.map((r) => r.sessionId)).toEqual(['s1']);
    });

    it('[FR-TERMINAL-170] non-all mode with no groupKey falls back to scopeType + scopeLabel', () => {
      const state = makeState([
        ['s1', meta({ groupKey: undefined, scopeType: 'project', scopeLabel: 'claude: web' })],
        ['s2', meta({ groupKey: undefined, scopeType: 'project', scopeLabel: 'claude: api' })],
        ['s3', meta({ groupKey: undefined, scopeType: 'dir', scopeLabel: 'claude: web' })],
      ]);

      const result = listTerminalSessions(state, {
        all: false,
        groupKey: null,
        scopeType: 'project',
        scopeLabel: 'claude: web',
      });

      expect(result.map((r) => r.sessionId)).toEqual(['s1']);
    });
  });
});
