import { describe, it, expect, vi } from 'vitest';
import { applyReconnectSnapshot } from './terminal-snapshot';

function createRecordingTerminal() {
  const calls: string[] = [];
  const term = {
    resize: vi.fn((cols: number, rows: number) => calls.push(`resize ${cols}x${rows}`)),
    reset: vi.fn(() => calls.push('reset')),
    write: vi.fn((data: string, callback?: () => void) => {
      calls.push(`write ${data}`);
      callback?.();
    }),
    scrollToBottom: vi.fn(() => calls.push('scrollToBottom')),
  };
  const refit = () => calls.push('refit');
  return { term, calls, refit };
}

describe('terminal snapshot', () => {
  describe('applyReconnectSnapshot', () => {
    it('[FR-TERMINAL-930] should size the grid to the snapshot, write it, then refit', () => {
      const { term, calls, refit } = createRecordingTerminal();

      applyReconnectSnapshot(term, { snapshot: 'frame', cols: 120, rows: 40 }, refit);

      expect(calls).toEqual(['resize 120x40', 'reset', 'write frame', 'scrollToBottom', 'refit']);
    });

    it('[FR-TERMINAL-930] should still write a snapshot that carries no size', () => {
      const { term, calls, refit } = createRecordingTerminal();

      applyReconnectSnapshot(term, { snapshot: 'frame' }, refit);

      expect(calls).toEqual(['reset', 'write frame', 'scrollToBottom', 'refit']);
    });
  });
});
