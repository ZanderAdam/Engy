/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clampWidth, readStoredWidth, type PanelConfig } from './use-panel-resize';

describe('use-panel-resize', () => {
  describe('clampWidth', () => {
    it('should return the value when within bounds', () => {
      expect(clampWidth(300, 200, 600)).toBe(300);
    });

    it('should clamp to minimum when value is too small', () => {
      expect(clampWidth(100, 200, 600)).toBe(200);
    });

    it('should clamp to maximum when value is too large', () => {
      expect(clampWidth(800, 200, 600)).toBe(600);
    });

    it('should return min when min equals max', () => {
      expect(clampWidth(500, 300, 300)).toBe(300);
    });

    it('should handle exact boundary values', () => {
      expect(clampWidth(200, 200, 600)).toBe(200);
      expect(clampWidth(600, 200, 600)).toBe(600);
    });
  });

  describe('readStoredWidth', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    const config: PanelConfig = {
      defaultWidth: 300,
      minWidth: 200,
      maxWidth: 600,
      storageKey: 'test-panel-width',
    };

    it('should return null when no storageKey is configured', () => {
      const noKeyConfig: PanelConfig = { defaultWidth: 300, minWidth: 200, maxWidth: 600 };
      expect(readStoredWidth(noKeyConfig)).toBeNull();
    });

    it('should return null when nothing is stored', () => {
      expect(readStoredWidth(config)).toBeNull();
    });

    it('should return stored width when within bounds', () => {
      localStorage.setItem('test-panel-width', '400');
      expect(readStoredWidth(config)).toBe(400);
    });

    it('should return null when stored value is below minimum', () => {
      localStorage.setItem('test-panel-width', '100');
      expect(readStoredWidth(config)).toBeNull();
    });

    it('should return null when stored value is above maximum', () => {
      localStorage.setItem('test-panel-width', '800');
      expect(readStoredWidth(config)).toBeNull();
    });

    it('should return null when stored value is not a number', () => {
      localStorage.setItem('test-panel-width', 'abc');
      expect(readStoredWidth(config)).toBeNull();
    });

    it('should return null when stored value is empty string', () => {
      localStorage.setItem('test-panel-width', '');
      expect(readStoredWidth(config)).toBeNull();
    });

    it('should accept exact boundary values', () => {
      localStorage.setItem('test-panel-width', '200');
      expect(readStoredWidth(config)).toBe(200);

      localStorage.setItem('test-panel-width', '600');
      expect(readStoredWidth(config)).toBe(600);
    });

    it('should parse integer from float string', () => {
      localStorage.setItem('test-panel-width', '350.7');
      expect(readStoredWidth(config)).toBe(350);
    });
  });
});
