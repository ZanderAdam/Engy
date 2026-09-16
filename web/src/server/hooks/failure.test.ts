import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { connectWorker, createDispatch } from '../terminal-dispatch';
import { recordStopFailure, clearFailureOnUserPromptSubmit, clearFailureOnStop } from './failure';
import { addSession, fakeDaemon, hookPayload } from './test-helpers';

describe('hooks/failure', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = setupTestDb();
    state = ctx.state;
    state.terminalDaemon = fakeDaemon().ws;
  });

  afterEach(() => {
    vi.useRealTimers();
    ctx.cleanup();
  });

  describe('recordStopFailure', () => {
    it('[FR-TERMINAL-840] records a rate_limit StopFailure and holds the session out of dispatch delivery', () => {
      const meta = addSession(state, 'w1');
      connectWorker(state, 'w1', 'worker one');

      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'rate_limit', message: 'try again later' }),
        meta,
        state,
        'w1',
      );

      expect(meta.lastFailure).toEqual(
        expect.objectContaining({ type: 'rate_limit', message: 'try again later' }),
      );

      const entry = createDispatch(state, 'w1', 'do the thing');
      expect(entry.status).toBe('queued');
    });

    it('falls back to "unknown" when no recognised field carries the error type', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(hookPayload('StopFailure', {}), meta, state, 'w1');
      expect(meta.lastFailure?.type).toBe('unknown');
      expect(meta.lastFailure?.message).toBe('');
    });

    it('reads a nested error.type / error.message shape', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(
        hookPayload('StopFailure', { error: { type: 'overloaded', message: 'too busy' } }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure).toEqual(
        expect.objectContaining({ type: 'overloaded', message: 'too busy' }),
      );
    });

    it('falls back to a string-valued error field when no type field is present', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(hookPayload('StopFailure', { error: 'billing_error' }), meta, state, 'w1');
      expect(meta.lastFailure?.type).toBe('billing_error');
    });

    it('never records from a StopFailure fired inside a subagent', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'rate_limit', agent_id: 'sub-1' }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure).toBeUndefined();
    });
  });

  describe('clearFailureOnUserPromptSubmit', () => {
    it('[FR-TERMINAL-840] restores deliverability on the next UserPromptSubmit', () => {
      const meta = addSession(state, 'w1');
      connectWorker(state, 'w1', 'worker one');
      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'rate_limit' }),
        meta,
        state,
        'w1',
      );

      clearFailureOnUserPromptSubmit(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure).toBeUndefined();

      const entry = createDispatch(state, 'w1', 'now deliverable');
      expect(entry.status).toBe('delivered');
    });

    it('never clears from a subagent UserPromptSubmit', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'rate_limit' }),
        meta,
        state,
        'w1',
      );

      clearFailureOnUserPromptSubmit(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1', agent_id: 'sub-1' }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure?.type).toBe('rate_limit');
    });

    it('is a no-op when there is no failure to clear', () => {
      const meta = addSession(state, 'w1');
      expect(() =>
        clearFailureOnUserPromptSubmit(
          hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
          meta,
          state,
          'w1',
        ),
      ).not.toThrow();
      expect(meta.lastFailure).toBeUndefined();
    });
  });

  describe('clearFailureOnStop', () => {
    it('[FR-TERMINAL-840] restores deliverability on the next Stop', () => {
      const meta = addSession(state, 'w1');
      connectWorker(state, 'w1', 'worker one');
      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'overloaded' }),
        meta,
        state,
        'w1',
      );

      clearFailureOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'recovered' }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure).toBeUndefined();

      const entry = createDispatch(state, 'w1', 'now deliverable');
      expect(entry.status).toBe('delivered');
    });

    it('never clears from a subagent Stop', () => {
      const meta = addSession(state, 'w1');
      recordStopFailure(
        hookPayload('StopFailure', { error_type: 'overloaded' }),
        meta,
        state,
        'w1',
      );

      clearFailureOnStop(
        hookPayload('Stop', {
          prompt_id: 'p1',
          last_assistant_message: 'sub reply',
          agent_id: 'sub-1',
        }),
        meta,
        state,
        'w1',
      );
      expect(meta.lastFailure?.type).toBe('overloaded');
    });
  });
});
