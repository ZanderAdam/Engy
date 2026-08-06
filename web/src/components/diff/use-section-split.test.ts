import { describe, it, expect } from 'vitest';
import { clampFraction, fractionFromPointer, readStoredFraction } from './use-section-split';

describe('section split', () => {
  describe('clampFraction', () => {
    it('leaves a balanced split untouched', () => {
      expect(clampFraction(0.5)).toBe(0.5);
    });

    it('keeps either section from being dragged shut', () => {
      expect(clampFraction(0)).toBeGreaterThan(0);
      expect(clampFraction(1)).toBeLessThan(1);
      expect(clampFraction(-5)).toBe(clampFraction(0));
      expect(clampFraction(5)).toBe(clampFraction(1));
    });
  });

  describe('fractionFromPointer', () => {
    it('maps the pointer to its share of the pane', () => {
      expect(fractionFromPointer(150, 100, 100)).toBeCloseTo(0.5);
      expect(fractionFromPointer(125, 100, 100)).toBeCloseTo(0.25);
    });

    it('clamps a pointer dragged past either edge', () => {
      expect(fractionFromPointer(0, 100, 100)).toBe(clampFraction(0));
      expect(fractionFromPointer(500, 100, 100)).toBe(clampFraction(1));
    });

    it('survives a pane with no measured height', () => {
      // Reading geometry before layout settles must not produce NaN.
      expect(Number.isFinite(fractionFromPointer(120, 100, 0))).toBe(true);
    });
  });

  describe('readStoredFraction', () => {
    it('restores a previously dragged split', () => {
      expect(readStoredFraction('0.65')).toBeCloseTo(0.65);
    });

    it('ignores nothing stored or unparseable storage', () => {
      expect(readStoredFraction(null)).toBeNull();
      expect(readStoredFraction('')).toBeNull();
      expect(readStoredFraction('not-a-number')).toBeNull();
    });

    it('clamps a stored value that would hide a section', () => {
      expect(readStoredFraction('0.99')).toBe(clampFraction(1));
    });
  });
});
