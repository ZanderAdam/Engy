import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import {
  connectWorker,
  createDispatch,
  resolveDispatchReply,
  resolveWorkerReply,
} from '../terminal-dispatch';
import { getDispatch } from '../terminal-dispatch-store';
import { settleDispatchOnStop, tagDispatchDeliveryTurn } from './dispatch';
import { addSession, fakeDaemon, hookPayload } from './test-helpers';

function dispatchPrompt(promptId: string, correlationId: string, overrides = {}) {
  return hookPayload('UserPromptSubmit', {
    prompt_id: promptId,
    prompt: `do the thing\n\n[engy-dispatch ${correlationId}] This request comes from another agent`,
    ...overrides,
  });
}

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

  describe('tagDispatchDeliveryTurn', () => {
    it('[FR-MCP-301] keeps a dispatch at written after the PTY write and marks it delivered on its own UserPromptSubmit', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      expect(getDispatch(entry.correlationId)?.status).toBe('written');
      expect(getDispatch(entry.correlationId)?.deliveredAt).toBeUndefined();

      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');

      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'delivered',
        deliveryPromptId: 'p1',
      });
      expect(getDispatch(entry.correlationId)?.deliveredAt).toBeDefined();
      expect(meta.currentPromptId).toBe('p1');
    });

    it('[FR-MCP-301] does not mark a dispatch delivered when its marker is only quoted before a later marker', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', {
          prompt_id: 'quote',
          prompt: `result quoted [engy-dispatch ${entry.correlationId}]\n\n[engy-notice other] Do not reply. [engy-dispatch other-id]`,
        }),
        meta,
        state,
        'w1',
      );

      expect(getDispatch(entry.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-301] does not mark a dispatch delivered for a human turn, with or without the bare marker text', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      for (const prompt of [
        'please fix the typo',
        'what does [engy-dispatch] mean?',
        'what does [engy-dispatch other-id] mean?',
        undefined,
      ]) {
        tagDispatchDeliveryTurn(
          hookPayload('UserPromptSubmit', { prompt_id: 'human', prompt }),
          meta,
          state,
          'w1',
        );
      }
      expect(getDispatch(entry.correlationId)?.status).toBe('written');

      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');
      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'delivered',
        deliveryPromptId: 'p1',
      });
    });

    it('[FR-MCP-301] never tags a lost-paste row from another dispatch turn', () => {
      const meta = addSession(state, 'w1');
      const lost = createDispatch(state, 'w1', 'lost paste');
      vi.advanceTimersByTime(61_000);
      meta.activityState = 'idle';
      const next = createDispatch(state, 'w1', 'second');
      expect(getDispatch(next.correlationId)?.status).toBe('written');

      tagDispatchDeliveryTurn(dispatchPrompt('p2', next.correlationId), meta, state, 'w1');

      expect(getDispatch(lost.correlationId)?.status).toBe('written');
      expect(getDispatch(next.correlationId)).toMatchObject({
        status: 'delivered',
        deliveryPromptId: 'p2',
      });
      expect(resolveWorkerReply(state, 'w1', 'answer')?.correlationId).toBe(next.correlationId);
    });

    it('[FR-MCP-301] leaves a queued dispatch alone when a UserPromptSubmit arrives', () => {
      const meta = addSession(state, 'w1');
      meta.activityState = 'active';
      const entry = createDispatch(state, 'w1', 'waiting');

      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');

      expect(getDispatch(entry.correlationId)?.status).toBe('queued');
    });

    it('[FR-TERMINAL-810] tags a dispatch once and settles it only on the Stop of its own turn', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'first');
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');
      tagDispatchDeliveryTurn(dispatchPrompt('p2', entry.correlationId), meta, state, 'w1');

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p2', last_assistant_message: 'wrong turn' }),
        meta,
        state,
        'w1',
      );
      expect(getDispatch(entry.correlationId)?.status).toBe('delivered');

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'right turn' }),
        meta,
        state,
        'w1',
      );
      expect(getDispatch(entry.correlationId)?.status).toBe('stopped');
      expect(getDispatch(entry.correlationId)?.lastOutput).toBe('right turn');
    });
  });

  describe('id-less reply matching', () => {
    it('[FR-MCP-120] settles the row of the current turn when a stale delivered row exists', () => {
      const meta = addSession(state, 'w1');
      const stale = createDispatch(state, 'w1', 'stale');
      tagDispatchDeliveryTurn(dispatchPrompt('p1', stale.correlationId), meta, state, 'w1');
      vi.advanceTimersByTime(61_000);
      meta.activityState = 'idle';
      const fresh = createDispatch(state, 'w1', 'fresh');
      tagDispatchDeliveryTurn(dispatchPrompt('p2', fresh.correlationId), meta, state, 'w1');

      const settled = resolveWorkerReply(state, 'w1', 'fresh answer');

      expect(settled?.correlationId).toBe(fresh.correlationId);
      expect(getDispatch(stale.correlationId)?.status).toBe('delivered');
    });

    it('[FR-MCP-120] refuses an id-less reply when several rows are in flight and none is tagged by the current turn', () => {
      const meta = addSession(state, 'w1');
      const first = createDispatch(state, 'w1', 'one');
      vi.advanceTimersByTime(61_000);
      meta.activityState = 'idle';
      createDispatch(state, 'w1', 'two');
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'human', prompt: 'hello' }),
        meta,
        state,
        'w1',
      );

      expect(resolveWorkerReply(state, 'w1', 'answer')).toBeNull();
      expect(getDispatch(first.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-120] settles the only in-flight row for a worker whose current turn is not a dispatch turn', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'one');
      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'human', prompt: 'hello' }),
        meta,
        state,
        'w1',
      );

      expect(resolveWorkerReply(state, 'w1', 'answer')?.correlationId).toBe(entry.correlationId);
    });

    it('[FR-MCP-310] attaches a late id-less reply to the stopped row only while no new turn opened and within 10 minutes', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'one');
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');
      settleDispatchOnStop(hookPayload('Stop', { prompt_id: 'p1' }), meta, state, 'w1');
      expect(getDispatch(entry.correlationId)?.status).toBe('stopped');

      tagDispatchDeliveryTurn(
        hookPayload('UserPromptSubmit', { prompt_id: 'human', prompt: 'hi' }),
        meta,
        state,
        'w1',
      );
      expect(resolveWorkerReply(state, 'w1', 'late')).toBeNull();

      meta.currentPromptId = 'p1';
      vi.advanceTimersByTime(10 * 60_000 + 1);
      expect(resolveWorkerReply(state, 'w1', 'late')).toBeNull();

      vi.setSystemTime(Date.now() - 10 * 60_000);
      expect(resolveWorkerReply(state, 'w1', 'late')?.correlationId).toBe(entry.correlationId);
    });

    it('[FR-MCP-310] errors on a duplicate late reply and sends no second notice', () => {
      addSession(state, 'orig');
      const meta = addSession(state, 'w1');
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'one', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');
      settleDispatchOnStop(hookPayload('Stop', { prompt_id: 'p1' }), meta, state, 'w1');
      expect(resolveWorkerReply(state, 'w1', 'late')?.correlationId).toBe(entry.correlationId);
      const frames = sent.length;

      expect(resolveWorkerReply(state, 'w1', 'late again')).toBeNull();
      expect(resolveDispatchReply(state, entry.correlationId, 'again')).toBe(false);
      expect(sent).toHaveLength(frames);
    });
  });

  describe('settleDispatchOnStop', () => {
    it('[FR-MCP-310] marks the dispatch its own turn carried as stopped with a reason and the last output, not replied', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'all done' }),
        meta,
        state,
        'w1',
      );

      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'stopped',
        settledBy: 'hook',
        lastOutput: 'all done',
        result: undefined,
      });
      expect(getDispatch(entry.correlationId)?.stopReason).toContain('without a terminal_reply');
    });

    it('[FR-MCP-310] does not settle a dispatch that was only written, because silence proves nothing', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'unrelated' }),
        meta,
        state,
        'w1',
      );

      expect(getDispatch(entry.correlationId)?.status).toBe('written');
    });

    it('[FR-TERMINAL-810] leaves the dispatch delivered when the Stop is for an unrelated turn', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p2', last_assistant_message: 'unrelated answer' }),
        meta,
        state,
        'w1',
      );

      expect(getDispatch(entry.correlationId)?.status).toBe('delivered');
      expect(getDispatch(entry.correlationId)?.lastOutput).toBeUndefined();
    });

    it('[FR-TERMINAL-820] is a no-op once terminal_reply has already settled the dispatch', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');

      expect(resolveDispatchReply(state, entry.correlationId, 'model replied first')).toBe(true);
      settleDispatchOnStop(
        hookPayload('Stop', { prompt_id: 'p1', last_assistant_message: 'hook would say this' }),
        meta,
        state,
        'w1',
      );

      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'replied',
        result: 'model replied first',
        settledBy: 'reply',
      });
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
      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), meta, state, 'w1');

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

      expect(getDispatch(entry.correlationId)?.status).toBe('delivered');
    });

    it('[FR-TERMINAL-600] never tags from a subagent UserPromptSubmit', () => {
      const meta = addSession(state, 'w1');
      const entry = createDispatch(state, 'w1', 'do the thing');

      tagDispatchDeliveryTurn(
        dispatchPrompt('p1', entry.correlationId, { agent_id: 'sub-1' }),
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

      expect(getDispatch(entry.correlationId)?.status).toBe('written');
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

      tagDispatchDeliveryTurn(dispatchPrompt('p1', entry.correlationId), workerMeta, state, 'w1');
      settleDispatchOnStop(
        hookPayload('Stop', {
          prompt_id: 'p1',
          last_assistant_message: 'answer\x07\x1b[31mred\x1b[0m\x0bwith bells',
        }),
        workerMeta,
        state,
        'w1',
      );

      const stored = getDispatch(entry.correlationId);
      expect(stored?.lastOutput).toBe('answer[31mred[0mwith bells');
      expect(stored?.lastOutput).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);

      const toOrigin = sent
        .map((s) => JSON.parse(s) as { sessionId: string; d: string })
        .filter((f) => f.sessionId === 'orig');
      expect(toOrigin.length).toBeGreaterThan(0);
      for (const frame of toOrigin) {
        expect(frame.d).not.toMatch(/\x07|\x0b/);
      }
    });
  });
});
