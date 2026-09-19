import { describe, expect, it } from 'vitest';
import {
  computeDelta,
  formatDelta,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatMoneyPrecise,
  formatTokens,
  share,
} from './format';

describe('usage formatting', () => {
  describe('money', () => {
    it('should render integer cents as dollars', () => {
      expect(formatMoney(879_912)).toBe('$8,799.12');
    });

    it('should compact only above a thousand dollars', () => {
      expect(formatMoneyCompact(43_62_45)).toBe('$4.36K');
      expect(formatMoneyCompact(64_100)).toBe('$641.00');
    });

    it('should keep sub-cent per-call costs visible', () => {
      expect(formatMoneyPrecise(0.3)).toBe('$0.0030');
      expect(formatMoneyPrecise(641)).toBe('$6.41');
    });
  });

  describe('tokens', () => {
    it('should compact large token counts', () => {
      expect(formatTokens(9_827_909_264)).toBe('9.83B');
      expect(formatTokens(11_249_148)).toBe('11.25M');
    });
  });

  describe('share', () => {
    it('should return zero rather than NaN for an empty window', () => {
      expect(share(5, 0)).toBe(0);
    });
  });

  describe('computeDelta', () => {
    it('should return null when there is no previous window to compare', () => {
      expect(computeDelta(100, 0)).toBeNull();
    });

    it('should sign the direction', () => {
      expect(computeDelta(150, 100)).toEqual({ fraction: 0.5, direction: 'up' });
      expect(computeDelta(50, 100)).toEqual({ fraction: -0.5, direction: 'down' });
    });

    it('should treat a sub-0.1% move as flat', () => {
      expect(computeDelta(1000, 1000)?.direction).toBe('flat');
    });
  });

  describe('formatDelta', () => {
    it('should prefix a rise with a plus', () => {
      expect(formatDelta({ fraction: 0.5, direction: 'up' })).toBe('+50.0%');
      expect(formatDelta({ fraction: -0.5, direction: 'down' })).toBe('-50.0%');
    });
  });

  describe('formatDuration', () => {
    it('should switch to hours past sixty minutes', () => {
      expect(formatDuration(45)).toBe('45m');
      expect(formatDuration(120)).toBe('2h');
      expect(formatDuration(135)).toBe('2h 15m');
    });
  });
});
