import { describe, it, expect } from 'vitest';
import { shouldSendResize } from './terminal-resize';

describe('terminal resize guard', () => {
  describe('shouldSendResize', () => {
    it('should return false when cols and rows are both unchanged', () => {
      expect(shouldSendResize(80, 24, 80, 24)).toBe(false);
    });

    it('should return true when cols differ', () => {
      expect(shouldSendResize(100, 24, 80, 24)).toBe(true);
    });

    it('should return true when rows differ', () => {
      expect(shouldSendResize(80, 30, 80, 24)).toBe(true);
    });

    it('should return true when both cols and rows differ', () => {
      expect(shouldSendResize(100, 30, 80, 24)).toBe(true);
    });
  });
});
