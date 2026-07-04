import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { getAppState, resetAppState, type AppState } from '../context';

function addSession(state: AppState, sessionId: string): void {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    agentType: 'claude',
    activityState: 'idle',
    cols: 80,
    rows: 24,
  });
}

describe('terminal router', () => {
  let state: AppState;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    resetAppState();
    state = getAppState();
    caller = appRouter.createCaller({ state });
  });

  afterEach(() => {
    resetAppState();
  });

  describe('connectWorker', () => {
    it('should connect a live session as a dispatch worker', async () => {
      addSession(state, 'sess-1');
      await caller.terminal.connectWorker({ sessionId: 'sess-1', description: 'claude on auth' });

      const workers = await caller.terminal.listWorkers();
      expect(workers).toHaveLength(1);
      expect(workers[0]).toMatchObject({
        sessionId: 'sess-1',
        description: 'claude on auth',
        agentType: 'claude',
        alive: true,
      });
    });

    it('should reject unknown sessions', async () => {
      await expect(
        caller.terminal.connectWorker({ sessionId: 'ghost', description: 'x' }),
      ).rejects.toThrow('Terminal session not found');
    });

    it('should reject empty descriptions', async () => {
      addSession(state, 'sess-1');
      await expect(
        caller.terminal.connectWorker({ sessionId: 'sess-1', description: '   ' }),
      ).rejects.toThrow();
    });
  });

  describe('disconnectWorker', () => {
    it('should remove the worker from the connected set', async () => {
      addSession(state, 'sess-1');
      await caller.terminal.connectWorker({ sessionId: 'sess-1', description: 'worker' });
      await caller.terminal.disconnectWorker({ sessionId: 'sess-1' });
      expect(await caller.terminal.listWorkers()).toEqual([]);
    });
  });
});
