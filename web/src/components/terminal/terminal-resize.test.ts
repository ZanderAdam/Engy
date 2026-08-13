import { describe, it, expect } from 'vitest';
import { canFitPane, shouldSendResize } from './terminal-resize';

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

  describe('canFitPane', () => {
    it('[FR-TERMINAL-460] should refuse to fit a pane with no laid-out box', () => {
      expect(canFitPane(0, 0)).toBe(false);
    });

    it('[FR-TERMINAL-460] should refuse to fit a pane with only one measured axis', () => {
      expect(canFitPane(480, 0)).toBe(false);
      expect(canFitPane(0, 924)).toBe(false);
    });

    it('[FR-TERMINAL-460] should fit a pane the browser has measured', () => {
      expect(canFitPane(480, 924)).toBe(true);
    });
  });
});
