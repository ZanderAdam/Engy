import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { handleWorktreeCreate, handleWorktreeRemove } from './worktree';
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

describe('hooks/worktree', () => {
  let ctx: TestContext;
  let state: AppState;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('handleWorktreeCreate', () => {
    it('[FR-GIT-370] appends the worktree path from worktree_path', () => {
      const meta = addSession(state, 'w1');
      const result = handleWorktreeCreate(
        payload('WorktreeCreate', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual(['/repo/.worktrees/feature']);
      expect(result ?? {}).toEqual({});
    });

    it('falls back to `path` when worktree_path is absent', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(
        payload('WorktreeCreate', { path: '/repo/.worktrees/b' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual(['/repo/.worktrees/b']);
    });

    it('falls back to `cwd` when neither worktree_path nor path is present', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(
        payload('WorktreeCreate', { cwd: '/repo/.worktrees/c' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual(['/repo/.worktrees/c']);
    });

    it('ignores an event with no path field at all', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(payload('WorktreeCreate', {}), meta, state, 'w1');
      expect(meta.cliWorktrees).toBeUndefined();
    });

    it('does not duplicate an already-recorded path', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(
        payload('WorktreeCreate', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      handleWorktreeCreate(
        payload('WorktreeCreate', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual(['/repo/.worktrees/feature']);
    });

    it('[FR-GIT-370] never returns a blocking result', () => {
      const meta = addSession(state, 'w1');
      const result = handleWorktreeCreate(payload('WorktreeCreate', {}), meta, state, 'w1');
      expect(result ?? {}).toEqual({});
    });
  });

  describe('handleWorktreeRemove', () => {
    it('[FR-GIT-380] clears the recorded path', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(
        payload('WorktreeCreate', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      handleWorktreeRemove(
        payload('WorktreeRemove', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual([]);
    });

    it('a remove for an unknown path is a no-op', () => {
      const meta = addSession(state, 'w1');
      handleWorktreeCreate(
        payload('WorktreeCreate', { worktree_path: '/repo/.worktrees/feature' }),
        meta,
        state,
        'w1',
      );
      handleWorktreeRemove(
        payload('WorktreeRemove', { worktree_path: '/repo/.worktrees/other' }),
        meta,
        state,
        'w1',
      );
      expect(meta.cliWorktrees).toEqual(['/repo/.worktrees/feature']);
    });

    it('is a no-op when no worktrees are recorded', () => {
      const meta = addSession(state, 'w1');
      expect(() =>
        handleWorktreeRemove(
          payload('WorktreeRemove', { worktree_path: '/repo/.worktrees/feature' }),
          meta,
          state,
          'w1',
        ),
      ).not.toThrow();
      expect(meta.cliWorktrees).toBeUndefined();
    });

    it('never returns a blocking result', () => {
      const meta = addSession(state, 'w1');
      const result = handleWorktreeRemove(payload('WorktreeRemove', {}), meta, state, 'w1');
      expect(result ?? {}).toEqual({});
    });
  });
});
