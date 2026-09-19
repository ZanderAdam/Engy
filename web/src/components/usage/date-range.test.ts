import { describe, expect, it } from 'vitest';
import {
  matchPreset,
  parseRange,
  previousWindowLabel,
  rangeLengthDays,
  resolvePreset,
  toIsoDate,
} from './date-range';

const NOW = new Date(2026, 8, 19, 23, 30);

describe('usage date range', () => {
  describe('toIsoDate', () => {
    it('should bucket a late-evening local time onto the local day', () => {
      expect(toIsoDate(NOW)).toBe('2026-09-19');
    });
  });

  describe('resolvePreset', () => {
    it('should make today an inclusive single-day range', () => {
      expect(resolvePreset('today', NOW)).toEqual({ from: '2026-09-19', to: '2026-09-19' });
    });

    it('should count the current day as one of the last 7', () => {
      expect(resolvePreset('last7', NOW)).toEqual({ from: '2026-09-13', to: '2026-09-19' });
    });

    it('should start this month on the first', () => {
      expect(resolvePreset('thisMonth', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-19' });
    });

    it('should end last month on its final day', () => {
      expect(resolvePreset('lastMonth', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    });
  });

  describe('matchPreset', () => {
    it('should recognise a preset from its resolved dates', () => {
      expect(matchPreset({ from: '2026-08-21', to: '2026-09-19' }, NOW)).toBe('last30');
    });

    it('should return null for a custom range', () => {
      expect(matchPreset({ from: '2026-08-02', to: '2026-09-03' }, NOW)).toBeNull();
    });
  });

  describe('parseRange', () => {
    it('should read an explicit range from the URL', () => {
      const params = new URLSearchParams('from=2026-01-01&to=2026-01-31');
      expect(parseRange(params, NOW)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    });

    it('should fall back to last 30 days when the range is absent', () => {
      expect(parseRange(new URLSearchParams(), NOW)).toEqual(resolvePreset('last30', NOW));
    });

    it('should fall back when the dates are malformed or inverted', () => {
      const malformed = new URLSearchParams('from=yesterday&to=today');
      const inverted = new URLSearchParams('from=2026-09-19&to=2026-09-01');
      expect(parseRange(malformed, NOW)).toEqual(resolvePreset('last30', NOW));
      expect(parseRange(inverted, NOW)).toEqual(resolvePreset('last30', NOW));
    });
  });

  describe('rangeLengthDays', () => {
    it('should count both ends', () => {
      expect(rangeLengthDays({ from: '2026-09-19', to: '2026-09-19' })).toBe(1);
      expect(rangeLengthDays({ from: '2026-09-13', to: '2026-09-19' })).toBe(7);
    });

    it('should survive a daylight-saving boundary', () => {
      expect(rangeLengthDays({ from: '2026-03-28', to: '2026-03-30' })).toBe(3);
    });
  });

  describe('previousWindowLabel', () => {
    it('should name the equal-length preceding window', () => {
      expect(previousWindowLabel(resolvePreset('last30', NOW), NOW)).toBe('vs previous 30 days');
    });
  });
});
