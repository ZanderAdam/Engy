import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import type { AppState } from './trpc/context';
import { setupTestDb, type TestContext } from './trpc/test-helpers';
import { terminalSessionHistory } from './db/schema';
import { recordSessionStart } from './ws/terminal-session-history';
import {
  connectWorker,
  createDispatch,
  destroyTerminalSession,
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
  resolveWorkerReply,
  spawnAgentTerminal,
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
  let ctx: TestContext;
  let state: AppState;
  let sent: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    // Isolated DB per test — teardown and agent spawns write session history
    // and must never hit the ambient ~/.engy database.
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
    it('[FR-TERMINAL-270] should deliver immediately to an idle worker as a bracketed paste with the reply contract', () => {
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

    it('[FR-TERMINAL-270] should send Enter after the per-agent submit delay', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const entry = createDispatch(state, 'w1', 'go');
      expect(entry.status).toBe('delivered');
      expect(sent).toHaveLength(1);

      vi.advanceTimersByTime(350);

      const frames = inputFrames(sent);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toEqual({ t: 'i', sessionId: 'w1', d: '\r' });
    });

    it('[FR-TERMINAL-280] should queue when the worker is active', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('queued');
      expect(sent).toHaveLength(0);
      expect(state.dispatchInbox.get('w1')).toEqual([entry.correlationId]);
    });

    it('[FR-TERMINAL-280] should queue when the worker is waiting on a prompt', () => {
      addSession(state, 'w1', { activityState: 'waiting' });
      expect(createDispatch(state, 'w1', 'task').status).toBe('queued');
    });

    it('[FR-TERMINAL-280] should queue behind an existing queued dispatch even when idle', () => {
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

    it('[FR-TERMINAL-270] should strip bracketed-paste sentinels from the message so it cannot escape the paste', () => {
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

  describe('[FR-TERMINAL-840] StopFailure hold', () => {
    it('should queue a dispatch created while a StopFailure is on the session', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      state.terminalSessionMeta.get('w1')!.lastFailure = {
        type: 'rate_limit',
        message: 'rate limited',
        at: Date.now(),
      };
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('queued');
    });

    it('should recover deliverability once the bounded hold window elapses, with no further hook event', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      state.terminalSessionMeta.get('w1')!.lastFailure = {
        type: 'rate_limit',
        message: 'rate limited',
        at: Date.now(),
      };
      vi.advanceTimersByTime(5 * 60_000 + 1);
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('delivered');
    });

    it('should still deliver while a stale lastFailure sits past the window', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      state.terminalSessionMeta.get('w1')!.lastFailure = {
        type: 'server_error',
        message: '',
        at: Date.now() - 6 * 60_000,
      };
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('delivered');
    });
  });

  describe('flushDispatchInbox', () => {
    it('[FR-TERMINAL-280] should deliver exactly one queued dispatch when the worker goes idle', () => {
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

    it('[FR-TERMINAL-830] should record settledBy as reply', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      resolveDispatchReply(state, entry.correlationId, 'done');
      expect(entry.settledBy).toBe('reply');
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
    it('[FR-TERMINAL-290] should fail queued and delivered dispatches and clear the inbox', async () => {
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
    it('[FR-TERMINAL-300] should record output only for connected workers and cap the buffer', () => {
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

  describe('destroyTerminalSession', () => {
    function fakeBrowser(): { received: string[]; closed: boolean; ws: WebSocket } {
      const received: string[] = [];
      const holder = { received, closed: false, ws: null as unknown as WebSocket };
      holder.ws = {
        readyState: 1,
        OPEN: 1,
        send: (d: string) => received.push(d),
        close: () => {
          holder.closed = true;
        },
      } as unknown as WebSocket;
      return holder;
    }

    it('should send an exit frame and close attached browsers, skipping the excluded one', () => {
      addSession(state, 's1', { activityState: 'idle' });
      const sender = fakeBrowser();
      const other = fakeBrowser();
      state.terminalSessions.set('s1', new Set([sender.ws, other.ws]));

      destroyTerminalSession(state, 's1', { excludeWs: sender.ws });

      expect(other.received.some((f) => f.includes('"t":"exit"'))).toBe(true);
      expect(other.closed).toBe(true);
      expect(sender.received).toHaveLength(0);
      expect(sender.closed).toBe(false);
      expect(state.terminalSessions.has('s1')).toBe(false);
      expect(state.terminalSessionMeta.has('s1')).toBe(false);
    });

    it('should fail dispatches and drop the worker registration', () => {
      addSession(state, 's1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 's1', 'worker');
      const entry = createDispatch(state, 's1', 'task');

      destroyTerminalSession(state, 's1');

      expect(state.dispatchWorkers.has('s1')).toBe(false);
      expect(state.dispatches.get(entry.correlationId)?.status).toBe('failed');
    });
  });

  describe('replyContract', () => {
    it('should embed the correlation id for workers without a per-session MCP endpoint', () => {
      const text = replyContract('abc-123', false);
      expect(text).toContain('[engy-dispatch abc-123]');
      expect(text).toContain('terminal_reply');
      expect(text).toContain('"abc-123"');
    });

    it('[FR-TERMINAL-270] should omit the correlation id for identified workers', () => {
      const text = replyContract('abc-123', true);
      expect(text).toContain('[engy-dispatch]');
      expect(text).toContain('terminal_reply');
      expect(text).not.toContain('abc-123');
    });
  });

  describe('resolveWorkerReply', () => {
    it('[FR-MCP-120] should settle the oldest delivered dispatch for the worker', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const first = createDispatch(state, 'w1', 'first');
      // Rapid-fire race: the activity state hasn't flipped yet, so the second
      // dispatch also delivers immediately. Skew deliveredAt (frozen clock)
      // so oldest-first matching is exercised by timestamp, not map order.
      const second = createDispatch(state, 'w1', 'second');
      expect(second.status).toBe('delivered');
      second.deliveredAt = (first.deliveredAt ?? 0) + 5;

      const settled = resolveWorkerReply(state, 'w1', 'done with first');
      expect(settled?.correlationId).toBe(first.correlationId);
      expect(state.dispatches.get(first.correlationId)?.status).toBe('replied');
      expect(state.dispatches.get(second.correlationId)?.status).toBe('delivered');
    });

    it('[FR-MCP-120] should return null when the worker has no delivered dispatch', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      expect(resolveWorkerReply(state, 'w1', 'orphan')).toBeNull();
    });

    it('[FR-TERMINAL-830] should record settledBy as reply', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task');
      resolveWorkerReply(state, 'w1', 'done');
      expect(entry.settledBy).toBe('reply');
    });
  });

  describe('reply push notices', () => {
    it('[FR-MCP-180] should inject a settled notice into an idle origin terminal', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'codex worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'all done');

      const toOrigin = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(toOrigin).toHaveLength(1);
      expect(toOrigin[0].d).toContain(`[engy-notice ${entry.correlationId}]`);
      expect(toOrigin[0].d).toContain('codex worker');
      expect(toOrigin[0].d).toContain('all done');
      expect(toOrigin[0].d).toContain('Do not reply or re-dispatch');
    });

    it('[FR-MCP-180] should queue the notice while the origin is busy and flush it on idle', () => {
      addSession(state, 'orig', { activityState: 'active', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done');
      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(0);
      expect(state.dispatchReplyNotices.get('orig')).toHaveLength(1);

      state.terminalSessionMeta.get('orig')!.activityState = 'idle';
      flushDispatchInbox(state, 'orig');

      const toOrigin = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(toOrigin).toHaveLength(1);
      expect(toOrigin[0].d).toContain('[engy-notice');
      expect(state.dispatchReplyNotices.has('orig')).toBe(false);
    });

    it('[FR-MCP-180] should requeue notices when the daemon drops mid-flush', () => {
      addSession(state, 'orig', { activityState: 'active', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      resolveDispatchReply(state, entry.correlationId, 'done');
      expect(state.dispatchReplyNotices.get('orig')).toHaveLength(1);

      state.terminalDaemon = null;
      state.terminalSessionMeta.get('orig')!.activityState = 'idle';
      flushDispatchInbox(state, 'orig');

      expect(state.dispatchReplyNotices.get('orig')).toHaveLength(1);
    });

    it('[FR-MCP-180] should flush pending notices before a queued dispatch, one idle transition apart', () => {
      addSession(state, 'orig', { activityState: 'active', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'orig', 'orchestrator');
      connectWorker(state, 'w1', 'worker');

      // A notice queues for the busy origin...
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      resolveDispatchReply(state, entry.correlationId, 'done');
      // ...and a dispatch TO the origin queues behind it.
      const toOrig = createDispatch(state, 'orig', 'new work for orchestrator');
      expect(toOrig.status).toBe('queued');
      sent.length = 0;

      state.terminalSessionMeta.get('orig')!.activityState = 'idle';
      flushDispatchInbox(state, 'orig');
      const firstFlush = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(firstFlush).toHaveLength(1);
      expect(firstFlush[0].d).toContain('[engy-notice');
      expect(state.dispatches.get(toOrig.correlationId)?.status).toBe('queued');

      sent.length = 0;
      flushDispatchInbox(state, 'orig');
      const secondFlush = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(secondFlush).toHaveLength(1);
      expect(secondFlush[0].d).toContain('new work for orchestrator');
      expect(state.dispatches.get(toOrig.correlationId)?.status).toBe('delivered');
    });

    it('[FR-MCP-180] should notify the origin when the worker dispatch fails', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'doomed worker');
      createDispatch(state, 'w1', 'task', { originSessionId: 'orig', notifyOnReply: true });
      sent.length = 0;

      failWorkerDispatches(state, 'w1', 'Worker terminal exited');

      const toOrigin = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(toOrigin).toHaveLength(1);
      expect(toOrigin[0].d).toContain('failed: Worker terminal exited');
    });

    it('[FR-MCP-180] should drop the notice when the origin terminal is gone', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'ghost-origin',
        notifyOnReply: true,
      });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done');

      expect(inputFrames(sent)).toHaveLength(0);
      expect(state.dispatchReplyNotices.size).toBe(0);
    });

    it('should not notify when notifyOnReply is unset (settled sync dispatch)', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', { originSessionId: 'orig' });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done');

      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(0);
    });
  });

  describe('session history', () => {
    function historyRows() {
      return ctx.db.select().from(terminalSessionHistory).all();
    }

    function spawnWorker(): { sessionId: string } | null {
      return spawnAgentTerminal(state, {
        agentType: 'claude',
        workingDir: '/tmp/proj',
        description: 'spawned worker',
        spawnedBy: 'caller-sess',
        callerMeta: {
          scopeType: 'project',
          scopeLabel: 'caller',
          workingDir: '/tmp/proj',
          workspaceSlug: 'ws1',
          cols: 80,
          rows: 24,
        },
        mcpOrigin: 'http://localhost:3000',
      });
    }

    it('[FR-TERMINAL-320] should substitute the session-id placeholder in agent-spawned commands', () => {
      const result = spawnWorker();

      expect(result).not.toBeNull();
      const spawn = JSON.parse(sent[0]) as { command: string };
      expect(spawn.command).not.toContain('__ENGY_SESSION__');
      expect(spawn.command).toContain(`--session-id ${result!.sessionId}`);
    });

    it('[FR-TERMINAL-340] should create a history row for agent-spawned terminals', () => {
      const result = spawnWorker();

      const rows = historyRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sessionId: result!.sessionId,
        agentType: 'claude',
        workingDir: '/tmp/proj',
        summary: 'spawned worker',
        workspaceSlug: 'ws1',
        closedAt: null,
      });
    });

    it('[FR-TERMINAL-340] should stamp closedAt when an agent session is destroyed', () => {
      addSession(state, 'agent-sess', { agentType: 'claude' });
      recordSessionStart('agent-sess', state.terminalSessionMeta.get('agent-sess')!);

      destroyTerminalSession(state, 'agent-sess');

      const rows = historyRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].closedAt).not.toBeNull();
    });

    it('[FR-TERMINAL-340] should not record destroyed shell sessions', () => {
      addSession(state, 'shell-sess');

      destroyTerminalSession(state, 'shell-sess');

      expect(historyRows()).toHaveLength(0);
    });
  });
});
