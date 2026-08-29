import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { handleSubagentStart, handleSubagentStop } from '../hooks/subagent';
import { loadPersistedTerminalSessions, persistTerminalSession } from './terminal-session-store';

function meta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'claude: web',
    workingDir: '/repo/web',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('terminal-session-store', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('loadPersistedTerminalSessions', () => {
    it('[FR-TERMINAL-860] resets activeSubagents on reload so a stale persisted count cannot desync', () => {
      persistTerminalSession('w1', meta({ activeSubagents: 3 }));
      state.terminalSessionMeta.clear();

      loadPersistedTerminalSessions(state);

      expect(state.terminalSessionMeta.get('w1')?.activeSubagents).toBeUndefined();
    });

    it(
      '[FR-TERMINAL-860] a SubagentStop after reload does not floor a live count to 0, ' +
        'because the reload already reset it to 0',
      () => {
        persistTerminalSession('w1', meta({ activeSubagents: 2 }));
        state.terminalSessionMeta.clear();

        loadPersistedTerminalSessions(state);
        const reloadedMeta = state.terminalSessionMeta.get('w1')!;

        handleSubagentStop({ hook_event_name: 'SubagentStop', session_id: 'w1', agent_id: 'sub-1' }, reloadedMeta, state, 'w1');

        expect(reloadedMeta.activeSubagents).toBe(0);

        handleSubagentStart(
          { hook_event_name: 'SubagentStart', session_id: 'w1', agent_id: 'sub-2' },
          reloadedMeta,
          state,
          'w1',
        );
        expect(reloadedMeta.activeSubagents).toBe(1);
      },
    );
  });
});
