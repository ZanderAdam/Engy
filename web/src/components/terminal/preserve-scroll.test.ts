import { describe, it, expect } from 'vitest';
import { writePreservingScroll } from './preserve-scroll';

/**
 * Fake of the emulator's scroll surface. `linesAdded` stands in for the
 * scrollback a write pushes up, and `scrollToBottom` models ghostty-web's
 * unconditional snap on write — the behaviour the helper has to undo.
 */
function createFakeTerminal({ viewportY = 0, scrollbackLength = 0, linesAdded = 0 } = {}) {
  const state = { viewportY, scrollbackLength };
  const writes: string[] = [];

  return {
    writes,
    state,
    getViewportY: () => state.viewportY,
    getScrollbackLength: () => state.scrollbackLength,
    scrollToLine: (line: number) => {
      state.viewportY = Math.min(line, state.scrollbackLength);
    },
    write: (data: string) => {
      writes.push(data);
      state.scrollbackLength += linesAdded;
      if (state.viewportY !== 0) state.viewportY = 0;
    },
  };
}

describe('terminal viewport', () => {
  describe('writePreservingScroll', () => {
    it('[FR-TERMINAL-460] should follow the bottom while the viewport is at the bottom', () => {
      const term = createFakeTerminal({ viewportY: 0, scrollbackLength: 100, linesAdded: 3 });

      writePreservingScroll(term, 'output');

      expect(term.writes).toEqual(['output']);
      expect(term.state.viewportY).toBe(0);
    });

    it('[FR-TERMINAL-460] should hold the same content in view while scrolled up', () => {
      const term = createFakeTerminal({ viewportY: 40, scrollbackLength: 100, linesAdded: 3 });

      writePreservingScroll(term, 'output');

      // Three new lines below means the pinned text is now three lines further up.
      expect(term.state.viewportY).toBe(43);
    });

    it('[FR-TERMINAL-460] should keep the viewport still when a write adds no scrollback', () => {
      const term = createFakeTerminal({ viewportY: 40, scrollbackLength: 100, linesAdded: 0 });

      writePreservingScroll(term, '\x1b[2J');

      expect(term.state.viewportY).toBe(40);
    });

    it('should not write empty data, which the emulator throws on', () => {
      const term = createFakeTerminal({ viewportY: 40, scrollbackLength: 100, linesAdded: 3 });

      writePreservingScroll(term, '');

      expect(term.writes).toEqual([]);
      expect(term.state.viewportY).toBe(40);
    });

    it('[FR-TERMINAL-460] should write the data exactly once', () => {
      const term = createFakeTerminal({ viewportY: 40, scrollbackLength: 100, linesAdded: 3 });

      writePreservingScroll(term, 'output');

      expect(term.writes).toEqual(['output']);
    });
  });
});
