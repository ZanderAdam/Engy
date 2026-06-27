import { describe, it, expect } from 'vitest';
import { createTerminalActivityParser } from './activity-parse.js';

describe('[FR-TERMINAL-130] createTerminalActivityParser (daemon)', () => {
  it('detects a standalone bell', () => {
    expect(createTerminalActivityParser().parse('output\x07').hasBell).toBe(true);
  });

  it('does not count an OSC-terminating bell as a standalone bell', () => {
    expect(createTerminalActivityParser().parse('\x1b]0;title\x07').hasBell).toBe(false);
  });

  it('does not mistake a split-OSC terminator bell for a bell across chunks', () => {
    const p = createTerminalActivityParser();
    p.parse('\x1b]0;title');
    expect(p.parse('rest\x07').hasBell).toBe(false);
  });

  it('detects a real bell after a split OSC', () => {
    const p = createTerminalActivityParser();
    p.parse('\x1b]0;title');
    expect(p.parse('\x07\x07').hasBell).toBe(true);
  });

  it('detects (y/n) and [Y/n] confirmation prompts', () => {
    expect(createTerminalActivityParser().parse('Overwrite? (y/n) ').hasPrompt).toBe(true);
    expect(createTerminalActivityParser().parse('Proceed [Y/n]').hasPrompt).toBe(true);
  });

  it('detects a numbered selection menu but not a version string', () => {
    expect(createTerminalActivityParser().parse('❯ 1. Yes').hasPrompt).toBe(true);
    expect(createTerminalActivityParser().parse('❯ 2.5.0 ready').hasPrompt).toBe(false);
  });

  it('does not flag a bare shell prompt or plain output', () => {
    expect(createTerminalActivityParser().parse('user ~/dev ❯ ').hasPrompt).toBe(false);
    expect(createTerminalActivityParser().parse('Building... done\r\n').hasPrompt).toBe(false);
  });
});
