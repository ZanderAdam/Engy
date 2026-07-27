import { describe, it, expect, vi } from 'vitest';
import { attachTouchScroll, createTouchScrollTracker } from './touch-scroll';

/**
 * A stand-in for the terminal container. `hasPointerCapture` is modelled
 * faithfully because the gesture's whole point is that moves keep arriving on
 * the captured element after xterm destroys whatever the finger first landed on.
 */
function createFakeTarget(clientHeight = 240) {
  const listeners = new Map<string, (event: never) => void>();
  const captured = new Set<number>();
  return {
    clientHeight,
    captured,
    listenerCount: () => listeners.size,
    emit: (type: string, event: unknown) => listeners.get(type)?.(event as never),
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  };
}

const touch = (clientY: number, pointerId = 1) => ({
  pointerId,
  pointerType: 'touch',
  isPrimary: true,
  clientY,
});

describe('terminal touch scrolling', () => {
  describe('attachTouchScroll', () => {
    it('[FR-TERMINAL-390] should capture the pointer so the drag survives the row it started on', () => {
      const target = createFakeTarget();
      const scrollLines = vi.fn();
      attachTouchScroll(target, { rows: () => 24, scrollLines });

      target.emit('pointerdown', touch(200));

      expect(target.captured.has(1)).toBe(true);
    });

    it('[FR-TERMINAL-390] should scroll while the pointer is captured', () => {
      const target = createFakeTarget(240);
      const scrollLines = vi.fn();
      attachTouchScroll(target, { rows: () => 24, scrollLines });

      target.emit('pointerdown', touch(200));
      target.emit('pointermove', touch(170));

      expect(scrollLines).toHaveBeenCalledWith(3);
    });

    it('[FR-TERMINAL-390] should ignore moves it never captured', () => {
      const target = createFakeTarget();
      const scrollLines = vi.fn();
      attachTouchScroll(target, { rows: () => 24, scrollLines });

      target.emit('pointermove', touch(170));

      expect(scrollLines).not.toHaveBeenCalled();
    });

    it('[FR-TERMINAL-390] should leave mouse pointers to xterm', () => {
      const target = createFakeTarget();
      const scrollLines = vi.fn();
      attachTouchScroll(target, { rows: () => 24, scrollLines });

      target.emit('pointerdown', { ...touch(200), pointerType: 'mouse' });
      target.emit('pointermove', { ...touch(170), pointerType: 'mouse' });

      expect(target.captured.size).toBe(0);
      expect(scrollLines).not.toHaveBeenCalled();
    });

    it('[FR-TERMINAL-390] should release the capture when the gesture ends', () => {
      const target = createFakeTarget();
      attachTouchScroll(target, { rows: () => 24, scrollLines: vi.fn() });

      target.emit('pointerdown', touch(200));
      target.emit('pointerup', touch(170));

      expect(target.captured.size).toBe(0);
    });

    it('[FR-TERMINAL-390] should release the capture when the gesture is cancelled', () => {
      const target = createFakeTarget();
      attachTouchScroll(target, { rows: () => 24, scrollLines: vi.fn() });

      target.emit('pointerdown', touch(200));
      target.emit('pointercancel', touch(200));

      expect(target.captured.size).toBe(0);
    });

    it('[FR-TERMINAL-390] should remove every listener on dispose', () => {
      const target = createFakeTarget();
      const dispose = attachTouchScroll(target, { rows: () => 24, scrollLines: vi.fn() });

      expect(target.listenerCount()).toBeGreaterThan(0);
      dispose();

      expect(target.listenerCount()).toBe(0);
    });
  });

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
