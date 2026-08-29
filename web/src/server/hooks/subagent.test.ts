import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { handleSubagentStart, handleSubagentStop } from './subagent';
import type { HookPayload } from './types';

function addSession(state: AppState, sessionId: string): TerminalSessionMeta {
  const meta: TerminalSessionMeta = {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    activityState: 'idle',
    agentType: 'claude',
    cols: 80,
    rows: 24,
  };
  state.terminalSessionMeta.set(sessionId, meta);
  return meta;
}

function payload(event: string, overrides: Partial<HookPayload> = {}): HookPayload {
  return { hook_event_name: event, session_id: 'claude-conv-id', ...overrides };
}

describe('hooks/subagent', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('handleSubagentStart', () => {
    it('[FR-TERMINAL-850] increments activeSubagents on the session', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(1);
    });

    it('[FR-TERMINAL-850] counts multiple concurrent subagents', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-2' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(2);
    });

    it('is idempotent for a duplicate start of the same agent_id', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(1);
    });

    it('is a no-op without an agent_id', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', {}), meta, state, 'w1');
      expect(meta.activeSubagents).toBeUndefined();
    });
  });

  describe('handleSubagentStop', () => {
    it('[FR-TERMINAL-850] decrements activeSubagents on the session', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-2' }), meta, state, 'w1');
      handleSubagentStop(
        payload('SubagentStop', { agent_id: 'sub-1', agent_type: 'general-purpose' }),
        meta,
        state,
        'w1',
      );
      expect(meta.activeSubagents).toBe(1);
    });

    it('[FR-TERMINAL-850] floors at zero for an unmatched stop (a killed session can drop a stop)', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStop(payload('SubagentStop', { agent_id: 'sub-1' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(0);
    });

    it('is idempotent for a duplicate stop of the same agent_id', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStop(payload('SubagentStop', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStop(payload('SubagentStop', { agent_id: 'sub-1' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(0);
    });

    it('start/stop pairs balance back to zero', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStart(payload('SubagentStart', { agent_id: 'sub-2' }), meta, state, 'w1');
      handleSubagentStop(payload('SubagentStop', { agent_id: 'sub-1' }), meta, state, 'w1');
      handleSubagentStop(payload('SubagentStop', { agent_id: 'sub-2' }), meta, state, 'w1');
      expect(meta.activeSubagents).toBe(0);
    });

    it('is a no-op without an agent_id', () => {
      const meta = addSession(state, 'w1');
      handleSubagentStop(payload('SubagentStop', {}), meta, state, 'w1');
      expect(meta.activeSubagents).toBeUndefined();
    });
  });
});
