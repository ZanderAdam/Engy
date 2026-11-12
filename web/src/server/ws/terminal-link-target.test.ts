import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { recordSessionStart, markSessionClosed } from './terminal-session-history';
import { resolveTerminalLinkTarget } from './terminal-link-target';
import type { TerminalSessionMeta } from '../trpc/context';

function makeMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'project: alpha',
    workingDir: '/repo',
    agentType: 'claude',
    workspaceSlug: 'ws-1',
    projectSlug: 'alpha',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('resolveTerminalLinkTarget', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    return () => ctx.cleanup();
  });

  it('[FR-TERMINAL-1210] should resolve a live session to its project and worktree', () => {
    ctx.state.terminalSessionMeta.set('live-1', makeMeta({ worktreeBranch: 'feat-x' }));

    expect(resolveTerminalLinkTarget(ctx.state, 'live-1')).toEqual({
      status: 'live',
      workspaceSlug: 'ws-1',
      projectSlug: 'alpha',
      worktreeBranch: 'feat-x',
    });
  });

  it('[FR-TERMINAL-1210] should take the worktree from groupKey when the branch changed later', () => {
    ctx.state.terminalSessionMeta.set(
      'live-3',
      makeMeta({ groupKey: 'project:ws-1:alpha:wt:feat-x', worktreeBranch: 'feat-moved' }),
    );

    expect(resolveTerminalLinkTarget(ctx.state, 'live-3')).toMatchObject({
      worktreeBranch: 'feat-x',
    });
  });

  it('[FR-TERMINAL-1210] should leave the worktree out when groupKey has none', () => {
    ctx.state.terminalSessionMeta.set(
      'live-4',
      makeMeta({ groupKey: 'project:ws-1:alpha', worktreeBranch: 'feat-moved' }),
    );

    expect(resolveTerminalLinkTarget(ctx.state, 'live-4')).toEqual({
      status: 'live',
      workspaceSlug: 'ws-1',
      projectSlug: 'alpha',
    });
  });

  it('[FR-TERMINAL-1210] should mark a shell session so the shell dock opens', () => {
    ctx.state.terminalSessionMeta.set(
      'shell-1',
      makeMeta({ groupKey: 'shell:project:ws-1:alpha:wt:feat-x' }),
    );

    expect(resolveTerminalLinkTarget(ctx.state, 'shell-1')).toEqual({
      status: 'live',
      workspaceSlug: 'ws-1',
      projectSlug: 'alpha',
      worktreeBranch: 'feat-x',
      shell: true,
    });
  });

  it('[FR-TERMINAL-1210] should resolve a workspace session without a project', () => {
    ctx.state.terminalSessionMeta.set(
      'live-2',
      makeMeta({ scopeType: 'workspace', projectSlug: undefined }),
    );

    expect(resolveTerminalLinkTarget(ctx.state, 'live-2')).toEqual({
      status: 'live',
      workspaceSlug: 'ws-1',
    });
  });

  it('[FR-TERMINAL-1210] should report a dormant session as dormant', () => {
    ctx.state.terminalSessionMeta.set('dorm-1', makeMeta({ dormant: true }));

    expect(resolveTerminalLinkTarget(ctx.state, 'dorm-1')).toMatchObject({ status: 'dormant' });
  });

  it('[FR-TERMINAL-1220] should resolve a closed session from history', () => {
    recordSessionStart('gone-1', makeMeta({ worktreeBranch: 'feat-y' }));
    markSessionClosed('gone-1');

    expect(resolveTerminalLinkTarget(ctx.state, 'gone-1')).toEqual({
      status: 'closed',
      workspaceSlug: 'ws-1',
      projectSlug: 'alpha',
      worktreeBranch: 'feat-y',
    });
  });

  it('[FR-TERMINAL-1220] should return null for a session that never existed', () => {
    expect(resolveTerminalLinkTarget(ctx.state, 'nope')).toBeNull();
  });

  it('[FR-TERMINAL-1220] should return null for a closed resumed session id with no history row', () => {
    recordSessionStart('terminal-2', makeMeta({ resumedFrom: 'conversation-1' }));
    markSessionClosed('conversation-1');

    expect(resolveTerminalLinkTarget(ctx.state, 'terminal-2')).toBeNull();
  });

  it('[FR-TERMINAL-1220] should return null for a live session with no workspace', () => {
    ctx.state.terminalSessionMeta.set('orphan', makeMeta({ workspaceSlug: undefined }));

    expect(resolveTerminalLinkTarget(ctx.state, 'orphan')).toBeNull();
  });
});
