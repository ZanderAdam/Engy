import { describe, it, expect } from 'vitest';
import {
  admitSections,
  defaultReviewMode,
  resolveReviewMode,
  MAX_MOUNTED_SECTIONS,
  STACK_FILE_LIMIT,
} from './review-mode';

describe('review mode', () => {
  describe('defaultReviewMode', () => {
    it('should stack a small diff', () => {
      expect(defaultReviewMode(5)).toBe('stack');
    });

    it('should stack a diff right at the limit', () => {
      expect(defaultReviewMode(STACK_FILE_LIMIT)).toBe('stack');
    });

    it('should not stack a diff too large to hold in memory at once', () => {
      expect(defaultReviewMode(STACK_FILE_LIMIT + 1)).toBe('single');
      expect(defaultReviewMode(500)).toBe('single');
    });

    it('should not stack an empty diff, which has nothing to show', () => {
      expect(defaultReviewMode(0)).toBe('single');
    });
  });

  describe('resolveReviewMode', () => {
    it('should follow the file count when no preference is set', () => {
      expect(resolveReviewMode(null, 5)).toBe('stack');
      expect(resolveReviewMode(null, 0)).toBe('single');
    });

    it('should honour a preference for one file on a small diff', () => {
      expect(resolveReviewMode('single', 2)).toBe('single');
    });

    it('should honour a preference for the stack on a large diff', () => {
      expect(resolveReviewMode('stack', 500)).toBe('stack');
    });
  });

  describe('admitSections', () => {
    it('should admit sections that come into view', () => {
      expect(admitSections(new Set(), ['a', 'b'])).toEqual(new Set(['a', 'b']));
    });

    it('should keep sections already mounted', () => {
      expect(admitSections(new Set(['a']), ['b'])).toEqual(new Set(['a', 'b']));
    });

    it('should return the same set when nothing is new, so state does not churn', () => {
      const previous = new Set(['a', 'b']);

      expect(admitSections(previous, ['a'])).toBe(previous);
    });

    it('should stop admitting at the cap', () => {
      const arrived = Array.from({ length: 10 }, (_, i) => `f${i}`);

      expect(admitSections(new Set(), arrived, 4).size).toBe(4);
    });

    it('should admit only what fits when a burst overshoots the cap', () => {
      const result = admitSections(new Set(['a', 'b']), ['c', 'd', 'e'], 4);

      expect(result.size).toBe(4);
      expect(result.has('a')).toBe(true);
      expect(result.has('b')).toBe(true);
    });

    it('should return the same set once full, rather than a fresh equal one', () => {
      const full = new Set(['a', 'b']);

      expect(admitSections(full, ['c'], 2)).toBe(full);
    });

    it('should default to a cap well under what a large pull request would mount', () => {
      const arrived = Array.from({ length: 500 }, (_, i) => `f${i}`);

      expect(admitSections(new Set(), arrived).size).toBe(MAX_MOUNTED_SECTIONS);
    });
  });
});
