import { describe, it, expect } from 'vitest';
import { computeThumb, viewportYFromThumbTop } from './scrollbar';

// A 200px track showing 25 rows of a 100-line buffer: the thumb covers a
// quarter of the track, leaving 150px of travel.
const TRACK_PX = 200;
const ROWS = 25;
const SCROLLBACK = 75;

describe('terminal scrollbar', () => {
  describe('thumb geometry', () => {
    it('[FR-TERMINAL-490] should size the thumb to the share of the buffer on screen', () => {
      expect(computeThumb(TRACK_PX, ROWS, SCROLLBACK, 0).heightPx).toBe(50);
    });

    it('[FR-TERMINAL-490] should sit the thumb at the foot of the track while the viewport is at the bottom', () => {
      expect(computeThumb(TRACK_PX, ROWS, SCROLLBACK, 0).topPx).toBe(150);
    });

    it('[FR-TERMINAL-490] should sit the thumb at the head of the track while the viewport is at the top', () => {
      expect(computeThumb(TRACK_PX, ROWS, SCROLLBACK, SCROLLBACK).topPx).toBe(0);
    });

    it('should place the thumb by how far the viewport sits above the bottom', () => {
      expect(computeThumb(TRACK_PX, ROWS, SCROLLBACK, SCROLLBACK / 2)).toEqual({
        topPx: 75,
        heightPx: 50,
      });
    });

    it('should keep the thumb grabbable however deep the scrollback', () => {
      expect(computeThumb(TRACK_PX, 24, 10_000, 0).heightPx).toBe(20);
    });

    it('should never propose a thumb longer than its track', () => {
      expect(computeThumb(12, 24, 1, 0).heightPx).toBe(12);
    });

    it('should collapse while the pane has no measurable height', () => {
      expect(computeThumb(0, 24, 500, 10)).toEqual({ topPx: 0, heightPx: 0 });
    });

    it('[FR-TERMINAL-490] should propose no thumb at all while the buffer has no scrollback', () => {
      expect(computeThumb(TRACK_PX, ROWS, 0, 0)).toEqual({ topPx: 0, heightPx: 0 });
    });
  });

  describe('dragging the thumb', () => {
    it('[FR-TERMINAL-490] should scroll to the bottom when the thumb is dragged to the foot of its travel', () => {
      expect(viewportYFromThumbTop(150, TRACK_PX, 50, SCROLLBACK)).toBe(0);
    });

    it('[FR-TERMINAL-490] should scroll to the top when the thumb is dragged to the head of its travel', () => {
      expect(viewportYFromThumbTop(0, TRACK_PX, 50, SCROLLBACK)).toBe(SCROLLBACK);
    });

    it('should round a mid-track position to the nearest line', () => {
      expect(viewportYFromThumbTop(75, TRACK_PX, 50, SCROLLBACK)).toBe(38);
    });

    it('should clamp a drag that runs past either end of the track', () => {
      expect(viewportYFromThumbTop(-80, TRACK_PX, 50, SCROLLBACK)).toBe(SCROLLBACK);
      expect(viewportYFromThumbTop(400, TRACK_PX, 50, SCROLLBACK)).toBe(0);
    });

    it('should return the viewport the thumb was placed for', () => {
      const viewportY = 40;
      const { topPx, heightPx } = computeThumb(TRACK_PX, ROWS, SCROLLBACK, viewportY);
      expect(viewportYFromThumbTop(topPx, TRACK_PX, heightPx, SCROLLBACK)).toBe(viewportY);
    });

    it('should hold at the bottom while the thumb fills its track', () => {
      expect(viewportYFromThumbTop(0, 20, 20, SCROLLBACK)).toBe(0);
    });
  });
});
