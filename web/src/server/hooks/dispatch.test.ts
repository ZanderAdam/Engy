import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { connectWorker, createDispatch, resolveDispatchReply } from '../terminal-dispatch';
import { settleDispatchOnStop, tagDispatchDeliveryTurn } from './dispatch';
import { addSession, fakeDaemon, hookPayload } from './test-helpers';

describe('hooks/dispatch', () => {
  let ctx: TestContext;
  let state: AppState;
  let sent: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = setupTestDb();
    state = ctx.state;
    const daemon = fakeDaemon();
    sent = daemon.sent;
    state.terminalDaemon = daemon.ws;
  });

  afterEach(() => {
    vi.useRealTimers();
    ctx.cleanup();
  });

  describe('settleDispatchOnStop', () => {
    it('[FR-TERMINAL-810] settles the dispatch its own turn carried, using last_assistant_message', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      expect(entry.status).toBe('delivered');

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'all done' }),
        meta,
        state,
        'w1',
      );

      expect(entry.status).toBe('replied');
      expect(entry.result).toBe('all done');
      expect(entry.settledBy).toBe('hook');
    });

    it('[FR-TERMINAL-810] leaves the dispatch delivered when the Stop is for an unrelated turn', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p2', last_assistant_message: 'unrelated answer' }),
        meta,
        state,
        'w1',
      );

      expect(entry.status).toBe('delivered');
      expect(entry.result).toBeUndefined();
    });

    it('[FR-TERMINAL-820] is a no-op once terminal_reply has already settled the dispatch', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );

      expect(resolveDispatchReply(state, entry.correlationId, 'model replied first')).toBe(true);
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'hook would say this' }),
        meta,
        state,
        'w1',
      );

      expect(entry.status).toBe('replied');
      expect(entry.result).toBe('model replied first');
      expect(entry.settledBy).toBe('reply');
    });

    it('[FR-TERMINAL-810] is a no-op with no outstanding dispatch', () => {
      const meta = addSession(state, 'w1');
      expect(() =>
        settleDispatchOnStop(
          hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'nothing pending' }),
          meta,
          state,
          'w1',
        ),
      ).not.toThrow();
    });

    it('[FR-TERMINAL-600] never settles a subagent Stop, even one carrying the tagged prompt_id', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );

      settleDispatchOnStop(
        hookPayload('Stop', {
          prompt_id: 'p1',
          last_assistant_message: 'a subagent said this',
          agent_id: 'sub-1',
        }),
        meta,
        state,
        'w1',
      );

      expect(entry.status).toBe('delivered');
    });

    it('[FR-TERMINAL-600] never tags from a subagent UserPromptSubmit', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1', agent_id: 'sub-1' }),
        meta,
        state,
        'w1',
      );
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'reply' }),
        meta,
        state,
        'w1',
      );

      expect(entry.status).toBe('delivered');
    });

    it('[FR-TERMINAL-810] strips control characters from last_assistant_message before it reaches the terminal injection', () => {
      addSession(state, 'orig');
      const workerMeta = addSession(state, 'w1');
      connectWorker(state, 'w1', 'worker one');
      const entry = createDispatch(state, 'w1', 'do the thing', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        workerMeta,
        state,
        'w1',
      );
      settleDispatchOnStop(
        hookPayload('Stop', {
          prompt_id: 'p1',
          last_assistant_message: 'answer\x07\x1b[31mred\x1b[0m\x0bwith bells',
        }),
        workerMeta,
        state,
        'w1',
      );

      expect(entry.result).toBe('answer[31mred[0mwith bells');
      expect(entry.result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);

      const toOrigin = sent
        .map((s) => JSON.parse(s) as { sessionId: string; d: string })
        .filter((f) => f.sessionId === 'orig');
      expect(toOrigin.length).toBeGreaterThan(0);
      for (const frame of toOrigin) {
        // The bracketed-paste wrapper itself is a control sequence — only assert
        // the settled reply body inside it carries none of the stripped ones.
        expect(frame.d).not.toMatch(/\x07|\x0b/);
      }
    });
  });

  describe('tagDispatchDeliveryTurn', () => {
    it('[FR-TERMINAL-810] only tags the oldest untagged delivered dispatch once', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'first');
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p1' }),
        meta,
        state,
        'w1',
      );
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'p2' }),
        meta,
        state,
        'w1',
      );

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p2', last_assistant_message: 'wrong turn' }),
        meta,
        state,
        'w1',
      );
      expect(entry.status).toBe('delivered');

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'right turn' }),
        meta,
        state,
        'w1',
      );
      expect(entry.status).toBe('replied');
      expect(entry.result).toBe('right turn');
    });
  });
});
