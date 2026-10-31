import { describe, it, expect, vi } from 'vitest';
import {
  closeNeedsConfirm,
  foreignTab,
  injectFallbackPanelId,
  planPinnedOpen,
  releasePanelSession,
  shouldHandleSessionChange,
  staleForeignId,
  tabsForRail,
  tabWithPinnedState,
} from './foreign-panel';
import type { SessionListItem } from './session-to-tab';
import type { TerminalTab } from './types';

function tab(sessionId: string, overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    sessionId,
    status: 'active',
    scope: {
      scopeType: 'workspace',
      scopeLabel: sessionId,
      workingDir: '/tmp',
      groupKey: 'g',
      workspaceSlug: 'ws',
    },
    ...overrides,
  };
}

function session(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: 'o',
    scopeType: 'workspace',
    scopeLabel: 'Orchestrator',
    workingDir: '/tmp',
    groupKey: 'workspace:ws',
    status: 'active',
    browserCount: 1,
    ...overrides,
  };
}

function stateFor(tabs: TerminalTab[]) {
  const kill = vi.fn();
  const discardDormant = vi.fn();
  return {
    kill,
    discardDormant,
    state: {
      tabs: new Map(tabs.map((t) => [t.sessionId, t])),
      actions: new Map(tabs.map((t) => [t.sessionId, { kill }])),
      discardDormant,
    },
  };
}

describe('foreignTab', () => {
  it('[FR-TERMINAL-1110] should mark the tab foreign and keep the session own group key', () => {
    const result = foreignTab(session(), 'project:p');
    expect(result.foreign).toBe(true);
    expect(result.scope.groupKey).toBe('workspace:ws');
  });

  it('[FR-TERMINAL-1110] should keep a dormant session restorable', () => {
    expect(foreignTab(session({ dormant: true }), 'project:p').status).toBe('dormant');
  });
});

describe('releasePanelSession', () => {
  it('[FR-TERMINAL-1120] should not kill the session when a foreign panel closes', () => {
    const { state, kill, discardDormant } = stateFor([tab('o', { foreign: true })]);
    releasePanelSession('o', state);
    expect(kill).not.toHaveBeenCalled();
    expect(discardDormant).not.toHaveBeenCalled();
    expect(state.tabs.has('o')).toBe(false);
    expect(state.actions.has('o')).toBe(false);
  });

  it('[FR-TERMINAL-1120] should not discard a dormant foreign session', () => {
    const { state, discardDormant } = stateFor([tab('o', { foreign: true, status: 'dormant' })]);
    releasePanelSession('o', state);
    expect(discardDormant).not.toHaveBeenCalled();
  });

  it('[FR-TERMINAL-1120] should still kill the session of an own panel', () => {
    const { state, kill } = stateFor([tab('a')]);
    releasePanelSession('a', state);
    expect(kill).toHaveBeenCalledOnce();
  });

  it('[FR-TERMINAL-1120] should still discard a dormant own session', () => {
    const { state, discardDormant } = stateFor([tab('a', { status: 'dormant' })]);
    releasePanelSession('a', state);
    expect(discardDormant).toHaveBeenCalledWith('a');
  });
});

describe('tabsForRail', () => {
  it('[FR-TERMINAL-1100] should leave the foreign panel out of the rail list', () => {
    const tabs = [tab('a'), tab('o', { foreign: true })];
    expect(tabsForRail(tabs).map((t) => t.sessionId)).toEqual(['a']);
  });

  it('[FR-TERMINAL-1100] should leave out the hidden orchestrator session', () => {
    const tabs = [tab('a'), tab('o')];
    expect(tabsForRail(tabs, 'o').map((t) => t.sessionId)).toEqual(['a']);
  });
});

describe('staleForeignId', () => {
  it('[FR-TERMINAL-1130] should return the foreign panel when the role moved', () => {
    expect(staleForeignId([tab('a'), tab('o', { foreign: true })], 'n')).toBe('o');
  });

  it('[FR-TERMINAL-1130] should return the foreign panel when no orchestrator is left', () => {
    expect(staleForeignId([tab('o', { foreign: true })], undefined)).toBe('o');
  });

  it('[FR-TERMINAL-1130] should keep the foreign panel of the current orchestrator', () => {
    expect(staleForeignId([tab('o', { foreign: true })], 'o')).toBeNull();
  });
});

describe('planPinnedOpen', () => {
  const base = { global: false, sessionGroupKey: 'workspace:ws', dockGroupKey: 'project:p', hasPanel: false };

  it('[FR-TERMINAL-1110] should attach a foreign panel in a dock that does not own the session', () => {
    expect(planPinnedOpen(base)).toBe('attach');
  });

  it('[FR-TERMINAL-1110] should focus the panel the dock already holds', () => {
    expect(planPinnedOpen({ ...base, hasPanel: true })).toBe('focus');
  });

  it('[FR-TERMINAL-1110] should only focus in the dock that owns the session, even before its list loads', () => {
    expect(planPinnedOpen({ ...base, dockGroupKey: 'workspace:ws' })).toBe('focus');
  });

  it('[FR-TERMINAL-1110] should only focus in Command Center, which lists every session', () => {
    expect(planPinnedOpen({ ...base, global: true })).toBe('focus');
  });
});

describe('shouldHandleSessionChange', () => {
  const base = { global: false, payloadGroupKey: 'workspace:ws', dockGroupKey: 'project:p', known: false };

  it('[FR-TERMINAL-1100] should ignore another group key for an unknown session', () => {
    expect(shouldHandleSessionChange(base)).toBe(false);
  });

  it('[FR-TERMINAL-1100] should handle another group key for a session the dock holds', () => {
    expect(shouldHandleSessionChange({ ...base, known: true })).toBe(true);
  });

  it('[FR-TERMINAL-1100] should handle its own group key and every key in Command Center', () => {
    expect(shouldHandleSessionChange({ ...base, payloadGroupKey: 'project:p' })).toBe(true);
    expect(shouldHandleSessionChange({ ...base, global: true })).toBe(true);
    expect(shouldHandleSessionChange({ ...base, payloadGroupKey: undefined })).toBe(true);
  });
});

describe('injectFallbackPanelId', () => {
  it('[FR-TERMINAL-1110] should not use a foreign panel as the target of an unaddressed inject', () => {
    const tabs = new Map([['o', tab('o', { foreign: true })]]);
    expect(injectFallbackPanelId('o', tabs)).toBeUndefined();
  });

  it('[FR-TERMINAL-1110] should keep an own active panel', () => {
    const tabs = new Map([['a', tab('a')]]);
    expect(injectFallbackPanelId('a', tabs)).toBe('a');
  });
});

describe('closeNeedsConfirm', () => {
  it('[FR-TERMINAL-1120] should close a foreign panel without the end-session dialog', () => {
    expect(closeNeedsConfirm(tab('o', { foreign: true }))).toBe(false);
  });

  it('[FR-TERMINAL-1120] should confirm before closing an own panel', () => {
    expect(closeNeedsConfirm(tab('a'))).toBe(true);
  });
});

describe('tabWithPinnedState', () => {
  it('[FR-TERMINAL-1100] should copy attention and activity from the server session', () => {
    const result = tabWithPinnedState(
      tab('o', { foreign: true, activityState: 'idle' }),
      session({ needsAttention: true, activityState: 'waiting' }),
    );
    expect(result?.needsAttention).toBe(true);
    expect(result?.activityState).toBe('waiting');
  });

  it('[FR-TERMINAL-1100] should return null when nothing changed', () => {
    const current = tab('o', { foreign: true, activityState: 'idle', needsAttention: false });
    expect(
      tabWithPinnedState(current, session({ needsAttention: false, activityState: 'idle' })),
    ).toBeNull();
  });
});
