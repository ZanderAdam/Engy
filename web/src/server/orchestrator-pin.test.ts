import { describe, it, expect } from 'vitest';
import type { AppState, TerminalSessionMeta } from './trpc/context';
import { getOrchestratorPin } from './orchestrator-pin';

function meta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'workspace',
    scopeLabel: 'workspace: ws',
    workingDir: '/tmp',
    agentType: 'claude',
    activityState: 'idle',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function stateWith(sessions: Record<string, TerminalSessionMeta>): AppState {
  return {
    terminalSessionMeta: new Map(Object.entries(sessions)),
    terminalSessions: new Map(),
  } as unknown as AppState;
}

describe('getOrchestratorPin', () => {
  it('[FR-TERMINAL-1090] should return null when no terminal holds the role', () => {
    expect(getOrchestratorPin(stateWith({ a: meta() }))).toBeNull();
  });

  it('[FR-TERMINAL-1090] should return the orchestrator session', () => {
    const pin = getOrchestratorPin(stateWith({ a: meta(), o: meta({ orchestrator: true }) }));
    expect(pin?.session.sessionId).toBe('o');
    expect(pin?.session.dormant).toBe(false);
  });

  it('[FR-TERMINAL-1090] should return a dormant orchestrator so it can be restored', () => {
    const pin = getOrchestratorPin(stateWith({ o: meta({ orchestrator: true, dormant: true }) }));
    expect(pin?.session.dormant).toBe(true);
  });

  it('[FR-TERMINAL-1090] should count live terminals that wait or need attention, orchestrator included', () => {
    const pin = getOrchestratorPin(
      stateWith({
        o: meta({ orchestrator: true, activityState: 'waiting' }),
        w1: meta({ activityState: 'waiting' }),
        w2: meta({ activityState: 'active' }),
        w3: meta({ activityState: 'waiting', dormant: true }),
        w4: meta({ needsAttention: true }),
      }),
    );
    expect(pin?.waitingCount).toBe(3);
  });
});
