import { describe, it, expect } from 'vitest';
import { createTouchScrollTracker } from './touch-scroll';

describe('terminal touch scrolling', () => {
  describe('createTouchScrollTracker', () => {
    it('[FR-TERMINAL-390] should scroll towards the bottom when the finger moves up', () => {
      const tracker = createTouchScrollTracker();
      tracker.start(300);
      expect(tracker.advance(260, 20)).toBe(2);
    });

    it('[FR-TERMINAL-390] should scroll towards the scrollback when the finger moves down', () => {
      const tracker = createTouchScrollTracker();
      tracker.start(100);
      expect(tracker.advance(160, 20)).toBe(-3);
    });

    it('[FR-TERMINAL-390] should accumulate sub-line movement across moves', () => {
      const tracker = createTouchScrollTracker();
      tracker.start(100);
      expect(tracker.advance(94, 20)).toBe(0);
      expect(tracker.advance(88, 20)).toBe(0);
      expect(tracker.advance(82, 20)).toBe(0);
      expect(tracker.advance(76, 20)).toBe(1);
    });

    it('[FR-TERMINAL-390] should not carry movement from a previous drag into a new one', () => {
      const tracker = createTouchScrollTracker();
      tracker.start(100);
      tracker.advance(85, 20);
      tracker.start(100);
      expect(tracker.advance(90, 20)).toBe(0);
    });

    it('[FR-TERMINAL-390] should report no lines when the row height is unknown', () => {
      const tracker = createTouchScrollTracker();
      tracker.start(300);
      expect(tracker.advance(100, 0)).toBe(0);
    });
  });
});
