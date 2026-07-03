import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { createAppState, type AppState } from './trpc/context';
import {
  connectWorker,
  createDispatch,
  disconnectWorker,
  failWorkerDispatches,
  flushDispatchInbox,
  getWorkerOutputTail,
  injectTerminalInput,
  isTrackedWorker,
  listWorkers,
  recordWorkerOutput,
  replyContract,
  resolveDispatchReply,
  waitForDispatchReply,
} from './terminal-dispatch';

function fakeDaemon(): { sent: string[]; ws: WebSocket } {
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => sent.push(data),
  } as unknown as WebSocket;
  return { sent, ws };
}

function addSession(
  state: AppState,
  sessionId: string,
  overrides: Partial<{ activityState: 'idle' | 'active' | 'waiting' | 'done'; agentType: string }> = {},
): void {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    cols: 80,
    rows: 24,
    ...overrides,
  });
}

function inputFrames(sent: string[]): Array<{ t: string; sessionId: string; d: string }> {
  return sent.map((s) => JSON.parse(s));
}

describe('terminal dispatch', () => {
  let state: AppState;
  let sent: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    state = createAppState();
    const daemon = fakeDaemon();
    sent = daemon.sent;
    state.terminalDaemon = daemon.ws;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('injectTerminalInput', () => {
    it('should send a compact input frame to the terminal daemon', () => {
      expect(injectTerminalInput(state, 'sess-1', 'hello')).toBe(true);
      expect(inputFrames(sent)).toEqual([{ t: 'i', sessionId: 'sess-1', d: 'hello' }]);
    });

    it('should return false when no daemon is connected', () => {
      state.terminalDaemon = null;
      expect(injectTerminalInput(state, 'sess-1', 'hello')).toBe(false);
    });
  });

  describe('createDispatch', () => {
    it('[FR-TERMINAL-160] should deliver immediately to an idle worker as a bracketed paste with the reply contract', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      connectWorker(state, 'w1', 'worker one');

      const entry = createDispatch(state, 'w1', 'fix the tests');

      expect(entry.status).toBe('delivered');
      const frames = inputFrames(sent);
      expect(frames).toHaveLength(1);
      expect(frames[0].sessionId).toBe('w1');
      expect(frames[0].d.startsWith('\x1b[200~')).toBe(true);
      expect(frames[0].d.endsWith('\x1b[201~')).toBe(true);
      expect(frames[0].d).toContain('fix the tests');
      expect(frames[0].d).toContain(`[engy-dispatch ${entry.correlationId}]`);
      expect(frames[0].d).toContain('terminal_reply');
    });

    it('[FR-TERMINAL-160] should send Enter after the per-agent submit delay', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const entry = createDispatch(state, 'w1', 'go');
      expect(entry.status).toBe('delivered');
      expect(sent).toHaveLength(1);

      vi.advanceTimersByTime(350);

      const frames = inputFrames(sent);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toEqual({ t: 'i', sessionId: 'w1', d: '\r' });
    });

    it('[FR-TERMINAL-170] should queue when the worker is active', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('queued');
      expect(sent).toHaveLength(0);
      expect(state.dispatchInbox.get('w1')).toEqual([entry.correlationId]);
    });

    it('[FR-TERMINAL-170] should queue when the worker is waiting on a prompt', () => {
      addSession(state, 'w1', { activityState: 'waiting' });
      expect(createDispatch(state, 'w1', 'task').status).toBe('queued');
    });

    it('[FR-TERMINAL-170] should queue behind an existing queued dispatch even when idle', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const first = createDispatch(state, 'w1', 'first');
      state.terminalSessionMeta.get('w1')!.activityState = 'idle';
      const second = createDispatch(state, 'w1', 'second');
      expect(second.status).toBe('queued');
      expect(state.dispatchInbox.get('w1')).toEqual([first.correlationId, second.correlationId]);
    });

    it('should fail the dispatch when the daemon disconnects before delivery', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      state.terminalDaemon = null;
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('failed');
      expect(entry.error).toContain('daemon');
    });

    it('[FR-TERMINAL-160] should strip bracketed-paste sentinels from the message so it cannot escape the paste', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      createDispatch(state, 'w1', 'before \x1b[201~ rm -rf / \x1b[200~ after');

      const frame = inputFrames(sent)[0];
      // Exactly one opening and one closing sentinel — the ones we wrap with.
      expect(frame.d.match(/\x1b\[200~/g)).toHaveLength(1);
      expect(frame.d.match(/\x1b\[201~/g)).toHaveLength(1);
      expect(frame.d.startsWith('\x1b[200~')).toBe(true);
      expect(frame.d.endsWith('\x1b[201~')).toBe(true);
      expect(frame.d).toContain('before  rm -rf /  after');
    });
  });

  describe('flushDispatchInbox', () => {
    it('[FR-TERMINAL-170] should deliver exactly one queued dispatch when the worker goes idle', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const first = createDispatch(state, 'w1', 'first');
      const second = createDispatch(state, 'w1', 'second');

      state.terminalSessionMeta.get('w1')!.activityState = 'idle';
      flushDispatchInbox(state, 'w1');

      expect(state.dispatches.get(first.correlationId)?.status).toBe('delivered');
      expect(state.dispatches.get(second.correlationId)?.status).toBe('queued');
      expect(state.dispatchInbox.get('w1')).toEqual([second.correlationId]);
    });

    it('should not deliver while the worker is still busy', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const entry = createDispatch(state, 'w1', 'task');
      flushDispatchInbox(state, 'w1');
      expect(state.dispatches.get(entry.correlationId)?.status).toBe('queued');
    });
  });

  describe('resolveDispatchReply', () => {
    it('should settle a delivered dispatch and resolve waiters', async () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      const wait = waitForDispatchReply(state, entry.correlationId, 60_000);

      expect(resolveDispatchReply(state, entry.correlationId, 'done: fixed')).toBe(true);

      const settled = await wait;
      expect(settled.status).toBe('replied');
      expect(settled.result).toBe('done: fixed');
    });

    it('should reject a second reply for the same correlation id', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      expect(resolveDispatchReply(state, entry.correlationId, 'first')).toBe(true);
      expect(resolveDispatchReply(state, entry.correlationId, 'second')).toBe(false);
    });

    it('should reject unknown correlation ids', () => {
      expect(resolveDispatchReply(state, 'nope', 'result')).toBe(false);
    });
  });

  describe('waitForDispatchReply', () => {
    it('should resolve with the pending entry at timeout', async () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      const wait = waitForDispatchReply(state, entry.correlationId, 5_000);
      vi.advanceTimersByTime(5_000);
      const result = await wait;
      expect(result.status).toBe('delivered');
    });

    it('should reject for unknown correlation ids', async () => {
      await expect(waitForDispatchReply(state, 'nope', 1_000)).rejects.toThrow('Unknown correlationId');
    });
  });

  describe('failWorkerDispatches', () => {
    it('[FR-TERMINAL-180] should fail queued and delivered dispatches and clear the inbox', async () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const delivered = createDispatch(state, 'w1', 'first');
      state.terminalSessionMeta.get('w1')!.activityState = 'active';
      const queued = createDispatch(state, 'w1', 'second');
      const wait = waitForDispatchReply(state, delivered.correlationId, 60_000);

      failWorkerDispatches(state, 'w1', 'Worker terminal exited');

      expect((await wait).status).toBe('failed');
      expect(state.dispatches.get(queued.correlationId)?.status).toBe('failed');
      expect(state.dispatchInbox.has('w1')).toBe(false);
    });

    it('should leave settled dispatches untouched', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      resolveDispatchReply(state, entry.correlationId, 'done');
      failWorkerDispatches(state, 'w1', 'exited');
      expect(state.dispatches.get(entry.correlationId)?.status).toBe('replied');
      expect(state.dispatches.get(entry.correlationId)?.result).toBe('done');
    });
  });

  describe('output tail', () => {
    it('[FR-TERMINAL-190] should record output only for connected workers and cap the buffer', () => {
      connectWorker(state, 'w1', 'worker');
      expect(isTrackedWorker(state, 'w1')).toBe(true);
      expect(isTrackedWorker(state, 'other')).toBe(false);

      recordWorkerOutput(state, 'w1', 'x'.repeat(9_000));
      recordWorkerOutput(state, 'w1', 'tail-end');
      const tail = state.terminalOutputTails.get('w1')!;
      expect(tail.length).toBeLessThanOrEqual(8_192);
      expect(tail.endsWith('tail-end')).toBe(true);
    });

    it('should strip ANSI escapes from the returned tail', () => {
      connectWorker(state, 'w1', 'worker');
      recordWorkerOutput(state, 'w1', '\x1b[32mgreen\x1b[0m\r\nnext\x1b]0;title\x07line');
      expect(getWorkerOutputTail(state, 'w1')).toBe('green\nnextline');
    });

    it('should drop the tail when the worker disconnects', () => {
      connectWorker(state, 'w1', 'worker');
      recordWorkerOutput(state, 'w1', 'data');
      disconnectWorker(state, 'w1');
      expect(state.terminalOutputTails.has('w1')).toBe(false);
    });
  });

  describe('listWorkers', () => {
    it('should join worker descriptions with live session metadata', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'codex' });
      connectWorker(state, 'w1', 'codex on frontend');
      connectWorker(state, 'gone', 'dead session');

      const workers = listWorkers(state);
      const w1 = workers.find((w) => w.sessionId === 'w1')!;
      expect(w1).toMatchObject({
        description: 'codex on frontend',
        agentType: 'codex',
        scopeLabel: 'label-w1',
        activityState: 'active',
        alive: true,
      });
      expect(workers.find((w) => w.sessionId === 'gone')!.alive).toBe(false);
    });
  });

  describe('replyContract', () => {
    it('should reference terminal_reply and embed the correlation id', () => {
      const text = replyContract('abc-123');
      expect(text).toContain('[engy-dispatch abc-123]');
      expect(text).toContain('terminal_reply');
      expect(text).toContain('"abc-123"');
    });
  });
});
