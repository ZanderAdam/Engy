import { describe, it, expect } from 'vitest';
import { defaultReviewMode, resolveReviewMode } from './review-mode';

describe('review mode', () => {
  describe('defaultReviewMode', () => {
    it('should stack a small diff', () => {
      expect(defaultReviewMode(5)).toBe('stack');
    });

    it('should stack a large diff, since sections mount lazily', () => {
      expect(defaultReviewMode(500)).toBe('stack');
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
});
