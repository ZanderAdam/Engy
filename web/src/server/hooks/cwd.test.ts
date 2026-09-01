import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import type { AppState } from '../trpc/context';
import { handleCwdChange, resolveTrackedDir } from './cwd';
import { addSession, fakeDaemon, hookPayload } from './test-helpers';

describe('agent working directory tracking', () => {
  let ctx: TestContext;
  let state: AppState;
  let daemon: ReturnType<typeof fakeDaemon>;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
    daemon = fakeDaemon();
    state.terminalDaemon = daemon.ws;
  });

  afterEach(() => ctx.cleanup());

  describe('resolveTrackedDir', () => {
    it('[FR-TERMINAL-870] should prefer the reported cwd over the spawn directory', () => {
      expect(resolveTrackedDir({ workingDir: '/repo', agentCwd: '/repo/.wt/feat' })).toBe(
        '/repo/.wt/feat',
      );
    });

    it('[FR-TERMINAL-870] should fall back to the spawn directory', () => {
      expect(resolveTrackedDir({ workingDir: '/repo' })).toBe('/repo');
    });
  });

  describe('handleCwdChange', () => {
    it('[FR-TERMINAL-870] should record a cwd that differs from the spawn directory and tell the daemon', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';

      handleCwdChange(hookPayload('Stop', { cwd: '/repo/.wt/feat' }), meta, state, 's1');

      expect(meta.agentCwd).toBe('/repo/.wt/feat');
      expect(meta.workingDir).toBe('/repo');
      expect(daemon.sent).toEqual([
        JSON.stringify({ t: 'cwd', sessionId: 's1', workingDir: '/repo/.wt/feat' }),
      ]);
    });

    it('[FR-TERMINAL-870] should do nothing when the cwd is the spawn directory', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';

      handleCwdChange(hookPayload('Stop', { cwd: '/repo' }), meta, state, 's1');

      expect(meta.agentCwd).toBeUndefined();
      expect(daemon.sent).toEqual([]);
    });

    it('[FR-TERMINAL-870] should not re-notify while the cwd is unchanged', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';

      handleCwdChange(hookPayload('Stop', { cwd: '/repo/.wt/feat' }), meta, state, 's1');
      handleCwdChange(hookPayload('Stop', { cwd: '/repo/.wt/feat' }), meta, state, 's1');

      expect(daemon.sent).toHaveLength(1);
    });

    it('[FR-TERMINAL-870] should follow a move back to the spawn directory', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';
      meta.agentCwd = '/repo/.wt/feat';

      handleCwdChange(hookPayload('Stop', { cwd: '/repo' }), meta, state, 's1');

      expect(meta.agentCwd).toBe('/repo');
      expect(daemon.sent).toEqual([
        JSON.stringify({ t: 'cwd', sessionId: 's1', workingDir: '/repo' }),
      ]);
    });

    it("[FR-TERMINAL-870] should ignore a subagent's own cwd", () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';

      handleCwdChange(
        hookPayload('Stop', { cwd: '/repo/.wt/isolated', agent_id: 'sub-1' }),
        meta,
        state,
        's1',
      );

      expect(meta.agentCwd).toBeUndefined();
      expect(daemon.sent).toEqual([]);
    });

    it('[FR-TERMINAL-870] should ignore a payload with no usable cwd', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';

      handleCwdChange(hookPayload('Stop'), meta, state, 's1');
      handleCwdChange(hookPayload('Stop', { cwd: '' }), meta, state, 's1');
      handleCwdChange(hookPayload('Stop', { cwd: 42 }), meta, state, 's1');

      expect(meta.agentCwd).toBeUndefined();
      expect(daemon.sent).toEqual([]);
    });

    it('[FR-TERMINAL-870] should still record the cwd when no daemon is connected', () => {
      const meta = addSession(state, 's1');
      meta.workingDir = '/repo';
      state.terminalDaemon = null;

      handleCwdChange(hookPayload('Stop', { cwd: '/repo/.wt/feat' }), meta, state, 's1');

      expect(meta.agentCwd).toBe('/repo/.wt/feat');
    });
  });
});
