import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { createAppState, type AppState } from './trpc/context';
import { setupTestDb, type TestContext } from './trpc/test-helpers';
import { terminalSessionHistory } from './db/schema';
import { recordSessionStart } from './ws/terminal-session-history';
import {
  getDispatch,
  insertDispatch,
  listNotices,
  listWorkerDispatches,
  saveDispatch,
} from './terminal-dispatch-store';
import {
  canInjectNow,
  checkSpawnLimits,
  connectWorker,
  countAgentSpawnedSessions,
  createDispatch,
  destroyTerminalSession,
  disconnectWorker,
  dispatchRefusal,
  recordHumanInput,
  dropSessionDispatchState,
  failQueuedDispatches,
  setDispatchOptOut,
  failWorkerDispatches,
  settleDispatch,
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

function queuedIds(workerSessionId: string): string[] {
  return listWorkerDispatches(workerSessionId, ['queued']).map((entry) => entry.correlationId);
}

function noticeTexts(originSessionId: string): string[] {
  return listNotices(originSessionId).map((notice) => notice.text);
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

      expect(entry.status).toBe('written');
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
      expect(entry.status).toBe('written');
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
      expect(queuedIds('w1')).toEqual([entry.correlationId]);
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
      expect(queuedIds('w1')).toEqual([first.correlationId, second.correlationId]);
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
      expect(entry.status).toBe('written');
    });

    it('should still deliver while a stale lastFailure sits past the window', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      state.terminalSessionMeta.get('w1')!.lastFailure = {
        type: 'server_error',
        message: '',
        at: Date.now() - 6 * 60_000,
      };
      const entry = createDispatch(state, 'w1', 'task');
      expect(entry.status).toBe('written');
    });
  });

  describe('flushDispatchInbox', () => {
    it('[FR-TERMINAL-280] should deliver exactly one queued dispatch when the worker goes idle', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const first = createDispatch(state, 'w1', 'first');
      const second = createDispatch(state, 'w1', 'second');

      state.terminalSessionMeta.get('w1')!.activityState = 'idle';
      flushDispatchInbox(state, 'w1');

      expect(getDispatch(first.correlationId)?.status).toBe('written');
      expect(getDispatch(second.correlationId)?.status).toBe('queued');
      expect(queuedIds('w1')).toEqual([second.correlationId]);
    });

    it('should not deliver while the worker is still busy', () => {
      addSession(state, 'w1', { activityState: 'active' });
      const entry = createDispatch(state, 'w1', 'task');
      flushDispatchInbox(state, 'w1');
      expect(getDispatch(entry.correlationId)?.status).toBe('queued');
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
      expect(getDispatch(entry.correlationId)?.settledBy).toBe('reply');
    });
  });

  describe('waitForDispatchReply', () => {
    it('should resolve with the pending entry at timeout', async () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      const wait = waitForDispatchReply(state, entry.correlationId, 5_000);
      vi.advanceTimersByTime(5_000);
      const result = await wait;
      expect(result.status).toBe('written');
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
      expect(getDispatch(queued.correlationId)?.status).toBe('failed');
      expect(queuedIds('w1')).toEqual([]);
    });

    it('should leave settled dispatches untouched', () => {
      addSession(state, 'w1', { activityState: 'idle' });
      const entry = createDispatch(state, 'w1', 'task');
      resolveDispatchReply(state, entry.correlationId, 'done');
      failWorkerDispatches(state, 'w1', 'exited');
      expect(getDispatch(entry.correlationId)?.status).toBe('replied');
      expect(getDispatch(entry.correlationId)?.result).toBe('done');
    });
  });

  describe('output tail', () => {
    it('[FR-TERMINAL-300] should buffer output for every agent terminal and not for shells', () => {
      addSession(state, 'agent', { agentType: 'claude' });
      addSession(state, 'shell');
      expect(isTrackedWorker(state, 'agent')).toBe(true);
      expect(isTrackedWorker(state, 'shell')).toBe(false);
      expect(isTrackedWorker(state, 'other')).toBe(false);
    });

    it('[FR-TERMINAL-300] should cap the buffer at 64 KB and keep the newest output', () => {
      recordWorkerOutput(state, 'w1', 'x'.repeat(70_000));
      recordWorkerOutput(state, 'w1', 'tail-end');
      const tail = state.terminalOutputTails.get('w1')!;
      expect(tail.length).toBeLessThanOrEqual(65_536);
      expect(tail.endsWith('tail-end')).toBe(true);
    });

    it('should strip ANSI escapes from the returned tail', () => {
      recordWorkerOutput(state, 'w1', '\x1b[32mgreen\x1b[0m\r\nnext\x1b]0;title\x07line');
      expect(getWorkerOutputTail(state, 'w1', 50)).toBe('green\nnextline');
    });

    it('[FR-MCP-140] should return only the last N lines', () => {
      recordWorkerOutput(state, 'w1', 'a\nb\nc\nd\ne');
      expect(getWorkerOutputTail(state, 'w1', 2)).toBe('d\ne');
    });

    it('should keep the tail when the worker is unplugged and drop it when the session dies', () => {
      connectWorker(state, 'w1', 'worker');
      recordWorkerOutput(state, 'w1', 'data');
      disconnectWorker(state, 'w1');
      expect(state.terminalOutputTails.has('w1')).toBe(true);
      dropSessionDispatchState(state, 'w1');
      expect(state.terminalOutputTails.has('w1')).toBe(false);
    });
  });

  describe('listWorkers', () => {
    it('[FR-MCP-130] should list every live agent terminal and flag the connected ones', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'codex' });
      addSession(state, 'free', { agentType: 'claude' });
      addSession(state, 'shell');
      addSession(state, 'sleeping', { agentType: 'claude' });
      state.terminalSessionMeta.get('sleeping')!.dormant = true;
      connectWorker(state, 'w1', 'codex on frontend');
      connectWorker(state, 'gone', 'dead session');

      const workers = listWorkers(state);

      expect(workers.map((w) => w.sessionId).sort()).toEqual(['free', 'w1']);
      expect(workers.find((w) => w.sessionId === 'w1')).toMatchObject({
        description: 'codex on frontend',
        agentType: 'codex',
        scopeLabel: 'label-w1',
        activityState: 'active',
        connected: true,
      });
      expect(workers.find((w) => w.sessionId === 'free')).toMatchObject({
        description: 'label-free',
        connected: false,
      });
    });

    it('[FR-MCP-130] should carry workspace, project, branch and task identity', () => {
      addSession(state, 'w1', { agentType: 'claude' });
      Object.assign(state.terminalSessionMeta.get('w1')!, {
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        taskId: 7,
      });
      expect(listWorkers(state)[0]).toMatchObject({
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        taskId: 7,
      });
    });
  });

  describe('dispatchRefusal', () => {
    beforeEach(() => {
      addSession(state, 'worker', { agentType: 'claude' });
      addSession(state, 'caller', { agentType: 'claude' });
    });

    it('[FR-MCP-110] should refuse an unconnected agent terminal for an ordinary caller', () => {
      expect(dispatchRefusal(state, 'caller', 'worker')).toContain('not connected');
      expect(dispatchRefusal(state, undefined, 'worker')).toContain('not connected');
    });

    it('[FR-MCP-110] should accept a connected worker for any caller', () => {
      connectWorker(state, 'worker', 'w');
      expect(dispatchRefusal(state, 'caller', 'worker')).toBeNull();
      expect(dispatchRefusal(state, undefined, 'worker')).toBeNull();
    });

    it('[FR-MCP-110] should accept any live agent terminal when the caller is the orchestrator', () => {
      state.terminalSessionMeta.get('caller')!.orchestrator = true;
      expect(dispatchRefusal(state, 'caller', 'worker')).toBeNull();
    });

    it('[FR-MCP-110] should refuse plain shells, dormant tabs, and itself even for the orchestrator', () => {
      state.terminalSessionMeta.get('caller')!.orchestrator = true;
      addSession(state, 'shell');
      expect(dispatchRefusal(state, 'caller', 'shell')).toContain('plain shell');
      state.terminalSessionMeta.get('worker')!.dormant = true;
      expect(dispatchRefusal(state, 'caller', 'worker')).toContain('no longer alive');
      expect(dispatchRefusal(state, 'caller', 'caller')).toContain('itself');
      expect(dispatchRefusal(state, 'caller', 'missing')).toContain('no longer alive');
    });

    it('[FR-MCP-110] should refuse a terminal the user opted out of dispatch, connected or not', () => {
      connectWorker(state, 'worker', 'w');
      state.terminalSessionMeta.get('worker')!.dispatchOptOut = true;
      state.terminalSessionMeta.get('caller')!.orchestrator = true;
      expect(dispatchRefusal(state, 'caller', 'worker')).toContain('turned dispatch off');
    });
  });

  describe('recordHumanInput', () => {
    beforeEach(() => addSession(state, 'w1', { agentType: 'claude' }));
    const frame = (d: string) => JSON.stringify({ t: 'i', sessionId: 'w1', d });

    it('[FR-TERMINAL-1050] should stamp the session on real keystrokes', () => {
      recordHumanInput(state, 'w1', frame('ls\r'));
      expect(state.terminalSessionMeta.get('w1')!.lastHumanInputAt).toBe(Date.now());
    });

    it('[FR-TERMINAL-1050] should ignore xterm focus and cursor-position reports', () => {
      for (const report of ['\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?1;2c']) {
        recordHumanInput(state, 'w1', frame(report));
      }
      expect(state.terminalSessionMeta.get('w1')!.lastHumanInputAt).toBeUndefined();
    });

    it('[FR-TERMINAL-1050] should count arrow keys and ignore malformed frames and unknown sessions', () => {
      recordHumanInput(state, 'w1', '{not json');
      expect(state.terminalSessionMeta.get('w1')!.lastHumanInputAt).toBeUndefined();
      recordHumanInput(state, 'ghost', frame('x'));
      recordHumanInput(state, 'w1', frame('\x1b[A'));
      expect(state.terminalSessionMeta.get('w1')!.lastHumanInputAt).toBeDefined();
    });
  });

  describe('human typing hold', () => {
    it('[FR-TERMINAL-1050] should queue a dispatch while a human typed in the worker moments ago', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('w1')!.lastHumanInputAt = Date.now();

      const entry = createDispatch(state, 'w1', 'task');

      expect(entry.status).toBe('queued');
      expect(sent).toHaveLength(0);
    });

    it('[FR-TERMINAL-1050] should deliver on its own once the typing hold expires', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('w1')!.lastHumanInputAt = Date.now();
      const entry = createDispatch(state, 'w1', 'task');

      vi.advanceTimersByTime(5_001);

      expect(getDispatch(entry.correlationId)?.status).toBe('written');
    });

    it('[FR-TERMINAL-1050] should keep a busy worker queued after the hold expires', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('w1')!.lastHumanInputAt = Date.now();
      const entry = createDispatch(state, 'w1', 'task');
      state.terminalSessionMeta.get('w1')!.activityState = 'active';

      vi.advanceTimersByTime(5_001);

      expect(getDispatch(entry.correlationId)?.status).toBe('queued');
    });

    it('[FR-TERMINAL-1050] should hold a settled notice for the origin while a human types there', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('orig')!.lastHumanInputAt = Date.now();
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done');
      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(0);

      vi.advanceTimersByTime(5_001);
      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(1);
    });
  });

  describe('durable dispatch state', () => {
    it('[FR-MCP-300] should keep queued dispatches and notices in SQLite across an app state reset', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'claude' });
      const entry = createDispatch(state, 'w1', 'survive restart', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      addSession(state, 'orig', { activityState: 'active', agentType: 'claude' });
      const done = createDispatch(state, 'orig', 'other');
      resolveDispatchReply(state, done.correlationId, 'x');

      const fresh = createAppState();
      fresh.terminalDaemon = state.terminalDaemon;
      fresh.terminalSessionMeta.set('w1', {
        ...state.terminalSessionMeta.get('w1')!,
        activityState: 'idle',
      });

      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'queued',
        message: 'survive restart',
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      expect(flushDispatchInbox(fresh, 'w1')).toBe(true);
      expect(getDispatch(entry.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-300] should deliver queued dispatches in creation order, one per idle transition', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'claude' });
      const ids = ['a', 'b', 'c'].map((m) => createDispatch(state, 'w1', m).correlationId);
      expect(queuedIds('w1')).toEqual(ids);
      state.terminalSessionMeta.get('w1')!.activityState = 'idle';
      flushDispatchInbox(state, 'w1');
      expect(queuedIds('w1')).toEqual(ids.slice(1));
    });
  });

  describe('stopped notices', () => {
    it('[FR-MCP-310] should push a stopped dispatch to the origin with the reason and last output', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      connectWorker(state, 'w1', 'quiet worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      settleDispatch(state, entry, 'stopped', {
        settledBy: 'hook',
        stopReason: 'the worker turn ended without a terminal_reply call',
        lastOutput: 'I looked at it but ran out of context',
      });

      const toOrigin = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(toOrigin).toHaveLength(1);
      expect(toOrigin[0].d).toContain('stopped without calling terminal_reply');
      expect(toOrigin[0].d).toContain('ran out of context');
      expect(getDispatch(entry.correlationId)).toMatchObject({
        status: 'stopped',
        settledBy: 'hook',
      });
    });

    it('[FR-MCP-310] should still accept a late terminal_reply for a stopped dispatch', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const entry = createDispatch(state, 'w1', 'task');
      settleDispatch(state, entry, 'stopped', { settledBy: 'hook' });

      expect(resolveDispatchReply(state, entry.correlationId, 'late answer')).toBe(true);
      expect(getDispatch(entry.correlationId)?.status).toBe('replied');
    });
  });

  describe('review fixes', () => {
    it('[FR-TERMINAL-280] should fail the queued dispatches of a terminal the user opts out', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'claude' });
      const queued = createDispatch(state, 'w1', 'task');

      setDispatchOptOut(state, 'w1', true);

      expect(getDispatch(queued.correlationId)).toMatchObject({ status: 'failed' });
      expect(getDispatch(queued.correlationId)?.error).toContain('turned dispatch off');
    });

    it('[FR-TERMINAL-280] should recheck the opt-out at flush and not deliver', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'claude' });
      const queued = createDispatch(state, 'w1', 'task');
      const meta = state.terminalSessionMeta.get('w1')!;
      meta.dispatchOptOut = true;
      meta.activityState = 'idle';
      sent.length = 0;

      expect(flushDispatchInbox(state, 'w1')).toBe(false);

      expect(getDispatch(queued.correlationId)?.status).toBe('failed');
      expect(sent).toHaveLength(0);
    });

    it('[FR-TERMINAL-280] should leave written and delivered rows alone when failing queued ones', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const written = createDispatch(state, 'w1', 'in flight');

      failQueuedDispatches(state, 'w1', 'x');

      expect(getDispatch(written.correlationId)?.status).toBe('written');
    });

    it('[FR-TERMINAL-280] should hold a second quick dispatch while the first is written, then release it after 60 seconds', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      const first = createDispatch(state, 'w1', 'first');
      const second = createDispatch(state, 'w1', 'second');
      expect(first.status).toBe('written');
      expect(second.status).toBe('queued');
      expect(inputFrames(sent).filter((f) => f.d.includes('second'))).toHaveLength(0);

      vi.advanceTimersByTime(60_001);

      expect(getDispatch(second.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-120] should still prefer an in-flight dispatch over a stopped one', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const stopped = createDispatch(state, 'w1', 'old');
      settleDispatch(state, stopped, 'stopped', { settledBy: 'hook' });
      vi.advanceTimersByTime(3_000);
      const live = createDispatch(state, 'w1', 'live');

      expect(resolveWorkerReply(state, 'w1', 'x')?.correlationId).toBe(live.correlationId);
    });

    it('[FR-TERMINAL-1050] should run the injected idle flush when the typing hold ends', () => {
      const flushed: string[] = [];
      state.deliveryRetryFlush = (_state, sessionId) => flushed.push(sessionId);
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('w1')!.lastHumanInputAt = Date.now();
      createDispatch(state, 'w1', 'task');

      vi.advanceTimersByTime(5_001);

      expect(flushed).toEqual(['w1']);
    });

    it('[FR-MCP-180] should keep a notice in SQLite for a dormant origin and not paste it', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      state.terminalSessionMeta.get('orig')!.dormant = true;
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done');

      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(0);
      expect(noticeTexts('orig')).toHaveLength(1);
      expect(flushDispatchInbox(state, 'orig')).toBe(false);
    });

    it('[FR-MCP-180] should add an evidence line with commitVerified to the notice', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      sent.length = 0;

      resolveDispatchReply(state, entry.correlationId, 'done', {
        commit: 'abc1234',
        commitVerified: 'not_found',
        commands: [
          { command: 'pnpm test', exitCode: 0 },
          { command: 'pnpm lint', exitCode: 1 },
        ],
        notVerified: ['browser'],
      });

      const text = inputFrames(sent).find((f) => f.sessionId === 'orig')!.d;
      expect(text).toContain('Evidence: commit abc1234 (not_found)');
      expect(text).toContain('2 commands, 1 failed');
      expect(text).toContain('1 not verified');
    });

    it('[FR-MCP-160] should mark a server-spawned terminal as a host session', () => {
      const result = spawnAgentTerminal(state, {
        agentType: 'claude',
        workingDir: '/tmp/proj',
        description: 'd',
        scope: { scopeType: 'workspace', workspaceSlug: 'ws' },
        mcpOrigin: 'http://localhost:3000',
      });
      expect(state.terminalSessionMeta.get(result!.sessionId)?.containerMode).toBe('host');
    });

    it('[FR-TERMINAL-280] should not let a settled-notice flush paste twice before the delayed Enter', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      const first = createDispatch(state, 'w1', 'a', { originSessionId: 'orig', notifyOnReply: true });
      state.terminalSessionMeta.get('orig')!.lastHumanInputAt = Date.now();
      resolveDispatchReply(state, first.correlationId, 'one');
      state.terminalSessionMeta.get('orig')!.lastHumanInputAt = undefined;
      sent.length = 0;

      flushDispatchInbox(state, 'orig');
      resolveDispatchReply(state, createDispatch(state, 'w1', 'b', { originSessionId: 'orig', notifyOnReply: true }).correlationId, 'two');
      flushDispatchInbox(state, 'orig');

      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(1);
    });

    it('[FR-TERMINAL-280] should hold a paste to a terminal that has a written dispatch, notices included', () => {
      addSession(state, 'orig', { activityState: 'idle', agentType: 'codex' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      const first = createDispatch(state, 'w1', 'a', { originSessionId: 'orig', notifyOnReply: true });
      const toOrig = createDispatch(state, 'orig', 'work for orig');
      expect(toOrig.status).toBe('written');
      sent.length = 0;

      resolveDispatchReply(state, first.correlationId, 'done');
      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig')).toHaveLength(0);
      expect(canInjectNow(state, 'orig')).toBe(false);

      vi.advanceTimersByTime(60_100);
      expect(inputFrames(sent).filter((f) => f.sessionId === 'orig').length).toBeGreaterThan(0);
    });

    it('[FR-TERMINAL-840] should retry delivery when the StopFailure hold ends', () => {
      state.deliveryRetryFlush = (_state, id) => flushDispatchInbox(state, id);
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      state.terminalSessionMeta.get('w1')!.lastFailure = {
        type: 'rate_limit',
        message: 'x',
        at: Date.now(),
      };
      const queued = createDispatch(state, 'w1', 'task');
      expect(queued.status).toBe('queued');

      vi.advanceTimersByTime(5 * 60_000 + 100);

      expect(getDispatch(queued.correlationId)?.status).toBe('written');
    });

    it('[FR-TERMINAL-1050] should let a shorter hold replace a pending longer retry', () => {
      state.deliveryRetryFlush = (_state, id) => flushDispatchInbox(state, id);
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const meta = state.terminalSessionMeta.get('w1')!;
      meta.lastFailure = { type: 'rate_limit', message: 'x', at: Date.now() };
      const queued = createDispatch(state, 'w1', 'task');
      meta.lastFailure = undefined;
      meta.lastHumanInputAt = Date.now();

      flushDispatchInbox(state, 'w1');
      vi.advanceTimersByTime(6_000);

      expect(getDispatch(queued.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-300] should prune settled rows by repliedAt and never prune unsettled rows', () => {
      const oldCreated = Date.now() - 2 * 60 * 60_000;
      const base = { workerSessionId: 'w1', message: 'm' };
      insertDispatch({ ...base, correlationId: 'settled-recent', status: 'replied', createdAt: oldCreated, repliedAt: Date.now() });
      insertDispatch({ ...base, correlationId: 'settled-old', status: 'replied', createdAt: oldCreated, repliedAt: oldCreated });
      insertDispatch({ ...base, correlationId: 'queued-old', status: 'queued', createdAt: oldCreated });
      insertDispatch({ ...base, correlationId: 'written-old', status: 'written', createdAt: oldCreated });

      createDispatch(state, 'w1', 'trigger prune');

      expect(getDispatch('settled-recent')).toBeDefined();
      expect(getDispatch('settled-old')).toBeUndefined();
      expect(getDispatch('queued-old')).toBeDefined();
      expect(getDispatch('written-old')).toBeDefined();
    });

    it('[FR-TERMINAL-1050] should not count mouse reports or OSC replies as typing', () => {
      addSession(state, 'w1', { agentType: 'claude' });
      const frame = (d: string) => JSON.stringify({ t: 'i', sessionId: 'w1', d });
      for (const report of ['\x1b[<0;12;5M', '\x1b[<0;12;5m', '\x1b]11;rgb:0000/0000/0000\x07', '\x1b]10;rgb:ffff/ffff/ffff\x1b\\', '\x1b[I\x1b[O']) {
        recordHumanInput(state, 'w1', frame(report));
      }
      expect(state.terminalSessionMeta.get('w1')!.lastHumanInputAt).toBeUndefined();
    });

    it('[FR-MCP-160] should forget a terminal spawn history when its session dies', () => {
      state.spawnAttempts.set('s1', [Date.now()]);
      dropSessionDispatchState(state, 's1');
      expect(state.spawnAttempts.has('s1')).toBe(false);
    });
  });

  describe('spawn limits', () => {
    it('[FR-MCP-160] should refuse a spawn past the depth limit of 2', () => {
      addSession(state, 'user-opened');
      addSession(state, 'child');
      state.terminalSessionMeta.get('child')!.spawnDepth = 1;
      addSession(state, 'grandchild');
      state.terminalSessionMeta.get('grandchild')!.spawnDepth = 2;
      const meta = (id: string) => state.terminalSessionMeta.get(id)!;

      expect(checkSpawnLimits(state, 'user-opened', meta('user-opened'))).toBeNull();
      expect(checkSpawnLimits(state, 'child', meta('child'))).toBeNull();
      expect(checkSpawnLimits(state, 'grandchild', meta('grandchild'))).toContain('depth limit');
    });

    it('[FR-MCP-160] should refuse a sixth live agent-spawned session', () => {
      addSession(state, 'caller');
      for (let i = 0; i < 5; i++) {
        addSession(state, `kid-${i}`);
        state.terminalSessionMeta.get(`kid-${i}`)!.spawnedBy = 'caller';
      }
      expect(checkSpawnLimits(state, 'caller', state.terminalSessionMeta.get('caller')!)).toContain(
        'terminal limit',
      );
    });

    it('[FR-MCP-160] should rate-limit spawns per caller even when slots are freed', () => {
      addSession(state, 'caller');
      const caller = state.terminalSessionMeta.get('caller')!;
      for (let i = 0; i < 10; i++) {
        expect(checkSpawnLimits(state, 'caller', caller)).toBeNull();
      }
      expect(checkSpawnLimits(state, 'caller', caller)).toContain('rate limit');

      vi.advanceTimersByTime(10 * 60_000 + 1);
      expect(checkSpawnLimits(state, 'caller', caller)).toBeNull();
    });

    it('[FR-MCP-170] should record the spawn depth and take the scope from the target', () => {
      const result = spawnAgentTerminal(state, {
        agentType: 'claude',
        workingDir: '/tmp/proj',
        description: 'd',
        spawnedBy: 'caller',
        spawnDepth: 2,
        scope: { scopeType: 'project', groupKey: 'project:ws:p', workspaceSlug: 'ws', projectSlug: 'p' },
        mcpOrigin: 'http://localhost:3000',
      });
      expect(state.terminalSessionMeta.get(result!.sessionId)).toMatchObject({
        spawnDepth: 2,
        groupKey: 'project:ws:p',
        projectSlug: 'p',
      });
    });
  });

  describe('countAgentSpawnedSessions', () => {
    it('[FR-TERMINAL-940] should not count sessions spawned by an agent review', () => {
      addSession(state, 'review');
      state.terminalSessionMeta.get('review')!.spawnedBy = 'auto-review';
      addSession(state, 'worker');
      state.terminalSessionMeta.get('worker')!.spawnedBy = 'caller-session';
      addSession(state, 'user-opened');

      expect(countAgentSpawnedSessions(state)).toBe(1);
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
      expect(getDispatch(entry.correlationId)?.status).toBe('failed');
    });
  });

  describe('replyContract', () => {
    it('should embed the correlation id for workers without a per-session MCP endpoint', () => {
      const text = replyContract('abc-123', false);
      expect(text).toContain('[engy-dispatch abc-123]');
      expect(text).toContain('terminal_reply');
      expect(text).toContain('"abc-123"');
    });

    it('[FR-TERMINAL-270] should carry the id in the marker but not ask identified workers to echo it', () => {
      const text = replyContract('abc-123', true);
      expect(text).toContain('[engy-dispatch abc-123]');
      expect(text).toContain('terminal_reply');
      expect(text).not.toContain('with correlationId');
    });
  });

  describe('resolveWorkerReply', () => {
    it('[FR-MCP-120] should settle the oldest in-flight dispatch for the worker', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const first = createDispatch(state, 'w1', 'first');
      const second = createDispatch(state, 'w1', 'second');
      expect(second.status).toBe('queued');

      const settled = resolveWorkerReply(state, 'w1', 'done with first');
      expect(settled?.correlationId).toBe(first.correlationId);
      expect(getDispatch(first.correlationId)?.status).toBe('replied');
      expect(getDispatch(second.correlationId)?.status).toBe('queued');
    });

    it('[FR-MCP-120] should prefer the delivered dispatch over a merely written one', () => {
      addSession(state, 'w1', { activityState: 'idle', agentType: 'claude' });
      const first = createDispatch(state, 'w1', 'first');
      const second = createDispatch(state, 'w1', 'second');
      const row = getDispatch(second.correlationId)!;
      row.status = 'delivered';
      saveDispatch(row);

      const settled = resolveWorkerReply(state, 'w1', 'done');

      expect(settled?.correlationId).toBe(second.correlationId);
      expect(getDispatch(first.correlationId)?.status).toBe('written');
    });

    it('[FR-MCP-120] should leave a queued dispatch alone when replying', () => {
      addSession(state, 'w1', { activityState: 'active', agentType: 'codex' });
      createDispatch(state, 'w1', 'queued only');
      expect(resolveWorkerReply(state, 'w1', 'x')).toBeNull();
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
      expect(getDispatch(entry.correlationId)?.settledBy).toBe('reply');
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
      expect(noticeTexts('orig')).toHaveLength(1);

      state.terminalSessionMeta.get('orig')!.activityState = 'idle';
      flushDispatchInbox(state, 'orig');

      const toOrigin = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(toOrigin).toHaveLength(1);
      expect(toOrigin[0].d).toContain('[engy-notice');
      expect(noticeTexts('orig')).toEqual([]);
    });

    it('[FR-MCP-180] should keep notices when the daemon drops mid-flush', () => {
      addSession(state, 'orig', { activityState: 'active', agentType: 'claude' });
      addSession(state, 'w1', { activityState: 'idle', agentType: 'codex' });
      connectWorker(state, 'w1', 'worker');
      const entry = createDispatch(state, 'w1', 'task', {
        originSessionId: 'orig',
        notifyOnReply: true,
      });
      resolveDispatchReply(state, entry.correlationId, 'done');
      expect(noticeTexts('orig')).toHaveLength(1);

      state.terminalDaemon = null;
      state.terminalSessionMeta.get('orig')!.activityState = 'idle';
      flushDispatchInbox(state, 'orig');

      expect(noticeTexts('orig')).toHaveLength(1);
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
      expect(getDispatch(toOrig.correlationId)?.status).toBe('queued');

      vi.advanceTimersByTime(3_000);
      sent.length = 0;
      flushDispatchInbox(state, 'orig');
      const secondFlush = inputFrames(sent).filter((f) => f.sessionId === 'orig');
      expect(secondFlush).toHaveLength(1);
      expect(secondFlush[0].d).toContain('new work for orchestrator');
      expect(getDispatch(toOrig.correlationId)?.status).toBe('written');
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
      expect(noticeTexts('ghost-origin')).toEqual([]);
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
        scope: { scopeType: 'project', workspaceSlug: 'ws1' },
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
