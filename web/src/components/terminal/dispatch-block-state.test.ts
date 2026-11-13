import { describe, expect, it } from 'vitest';
import { dispatchBlockState } from './dispatch-block-state';

describe('dispatchBlockState', () => {
  const agents = [
    { sessionId: 'open', dispatchOptOut: false },
    { sessionId: 'blocked', dispatchOptOut: true },
  ];

  it('[FR-TERMINAL-1280] should show a pressed button for an opted-out terminal', () => {
    expect(dispatchBlockState(agents, 'blocked')).toEqual({ enabled: true, blocked: true });
  });

  it('[FR-TERMINAL-1280] should show an unpressed button for a terminal that accepts dispatch', () => {
    expect(dispatchBlockState(agents, 'open')).toEqual({ enabled: true, blocked: false });
  });

  it('[FR-TERMINAL-1280] should disable the button when the active terminal is not a live agent', () => {
    expect(dispatchBlockState(agents, 'shell')).toEqual({ enabled: false, blocked: false });
    expect(dispatchBlockState(agents, undefined)).toEqual({ enabled: false, blocked: false });
  });
});
