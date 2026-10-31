import { describe, it, expect } from 'vitest';
import { orchestratorStateLabel, pinVisibleInSheet } from './orchestrator-pin-row';

describe('orchestratorStateLabel', () => {
  it('[FR-TERMINAL-1100] should show dormant for a dormant orchestrator', () => {
    expect(orchestratorStateLabel({ dormant: true, activityState: 'waiting' })).toBe('dormant');
  });

  it('[FR-TERMINAL-1100] should show the activity state of a live orchestrator', () => {
    expect(orchestratorStateLabel({ dormant: false, activityState: 'waiting' })).toBe('waiting');
  });

  it('[FR-TERMINAL-1100] should fall back to idle', () => {
    expect(orchestratorStateLabel({})).toBe('idle');
  });

  it('[FR-TERMINAL-1100] should show waiting for a session that needs attention', () => {
    expect(orchestratorStateLabel({ needsAttention: true, activityState: 'idle' })).toBe('waiting');
  });
});

describe('pinVisibleInSheet', () => {
  it('[FR-TERMINAL-1140] should show the pinned row in the terminal sheet once its dock is mounted', () => {
    expect(pinVisibleInSheet('terminal', true)).toBe(true);
    expect(pinVisibleInSheet('terminal', false)).toBe(false);
  });

  it('[FR-TERMINAL-1140] should not show it in the shell sheet', () => {
    expect(pinVisibleInSheet('shell', true)).toBe(false);
  });
});
