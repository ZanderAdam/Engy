import { describe, it, expect } from 'vitest';
import { zoomToPoint } from './zoom-pan-math';

const MIN = 0.2;
const MAX = 8;
const TOLERANCE = 1e-9;

describe('zoomToPoint', () => {
  describe('scale clamping', () => {
    it('should clamp scale at MIN when zooming out past the limit', () => {
      const result = zoomToPoint(0.25, 0, 0, 0.5, 0, 0, MIN, MAX);
      expect(result.scale).toBe(MIN);
    });

    it('should clamp scale at MAX when zooming in past the limit', () => {
      const result = zoomToPoint(7, 0, 0, 2, 0, 0, MIN, MAX);
      expect(result.scale).toBe(MAX);
    });

    it('should not alter scale when already at MIN and zooming further out', () => {
      const result = zoomToPoint(MIN, 0, 0, 0.1, 50, 50, MIN, MAX);
      expect(result.scale).toBe(MIN);
    });

    it('should not alter scale when already at MAX and zooming further in', () => {
      const result = zoomToPoint(MAX, 0, 0, 10, 50, 50, MIN, MAX);
      expect(result.scale).toBe(MAX);
    });
  });

  describe('zoom increases scale with factor > 1', () => {
    it('should increase scale when factor > 1', () => {
      const result = zoomToPoint(1, 0, 0, 1.1, 0, 0, MIN, MAX);
      expect(result.scale).toBeGreaterThan(1);
    });

    it('should decrease scale when factor < 1', () => {
      const result = zoomToPoint(1, 0, 0, 1 / 1.1, 0, 0, MIN, MAX);
      expect(result.scale).toBeLessThan(1);
    });
  });

  describe('zoom-to-point invariant: focal point stays fixed', () => {
    it('should keep focal point fixed in content space when zooming in at arbitrary cursor', () => {
      // The content point under the cursor is (px - tx) / scale in content coords.
      // After the zoom, (px - tx') / newScale should equal the same content coord.
      const scale = 1;
      const tx = -50;
      const ty = -30;
      const factor = 1.5;
      const px = 120;
      const py = 80;

      const before = { x: (px - tx) / scale, y: (py - ty) / scale };

      const result = zoomToPoint(scale, tx, ty, factor, px, py, MIN, MAX);
      const after = { x: (px - result.tx) / result.scale, y: (py - result.ty) / result.scale };

      expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
      expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
    });

    it('should keep focal point fixed when zooming out', () => {
      const scale = 2;
      const tx = 100;
      const ty = 60;
      const factor = 1 / 1.1;
      const px = 200;
      const py = 150;

      const before = { x: (px - tx) / scale, y: (py - ty) / scale };

      const result = zoomToPoint(scale, tx, ty, factor, px, py, MIN, MAX);
      const after = { x: (px - result.tx) / result.scale, y: (py - result.ty) / result.scale };

      expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
      expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
    });

    it('should keep origin fixed when cursor is at (0,0)', () => {
      const result = zoomToPoint(1, 0, 0, 2, 0, 0, MIN, MAX);
      expect(result.tx).toBeCloseTo(0, 9);
      expect(result.ty).toBeCloseTo(0, 9);
    });
  });
});
