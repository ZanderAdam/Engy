import { describe, expect, it } from 'vitest';
import {
  parseGuideSource,
  parseOverview,
  parseReadingOrder,
  parseRisk,
} from './review-summary-meta';

describe('review-summary-meta', () => {
  describe('[FR-PRREVIEW-200] parseRisk', () => {
    it('should keep a known level with its reason', () => {
      expect(parseRisk({ level: 'very_high', reason: 'Schema change' })).toEqual({
        level: 'very_high',
        reason: 'Schema change',
      });
    });

    it('should drop an unknown level or a non-object', () => {
      expect(parseRisk({ level: 'severe', reason: 'x' })).toBeUndefined();
      expect(parseRisk({ level: 'toString', reason: 'x' })).toBeUndefined();
      expect(parseRisk(null)).toBeUndefined();
      expect(parseRisk('high')).toBeUndefined();
    });

    it('should fall back to an empty reason', () => {
      expect(parseRisk({ level: 'low' })).toEqual({ level: 'low', reason: '' });
    });
  });

  describe('[FR-PRREVIEW-200] parseReadingOrder', () => {
    it('should keep well-formed chapters in order', () => {
      const chapters = [
        { title: 'Core', files: ['a.ts'], note: 'start here' },
        { title: 'Tests', files: ['a.test.ts'], note: 'covers it' },
      ];
      expect(parseReadingOrder(chapters)).toEqual(chapters);
    });

    it('should skip malformed chapters and non-string files', () => {
      expect(
        parseReadingOrder([{ title: 'Ok', files: ['a.ts', 3], note: 'n' }, { files: [] }, 'x']),
      ).toEqual([{ title: 'Ok', files: ['a.ts'], note: 'n' }]);
    });

    it('should return an empty list for anything but an array', () => {
      expect(parseReadingOrder(undefined)).toEqual([]);
      expect(parseReadingOrder({})).toEqual([]);
    });
  });

  describe('[FR-PRREVIEW-320] guided chapter fields', () => {
    it('should keep role, explanation, system context and risk on a chapter', () => {
      const chapter = {
        title: 'Core',
        files: ['a.ts'],
        note: 'check the guard',
        role: 'core',
        explanation: 'Moves the token check into `auth`.',
        systemContext: 'Every request passes through `auth`.',
        risk: { level: 'high', reason: 'Hot path' },
      };
      expect(parseReadingOrder([chapter])).toEqual([chapter]);
    });

    it('should drop an unknown role, a bad risk and empty texts but keep the chapter', () => {
      expect(
        parseReadingOrder([
          {
            title: 'Core',
            files: ['a.ts'],
            note: 'n',
            role: 'main',
            explanation: '  ',
            systemContext: 4,
            risk: { level: 'severe' },
          },
        ]),
      ).toEqual([{ title: 'Core', files: ['a.ts'], note: 'n' }]);
    });

    it('should keep a non-empty overview and drop anything else', () => {
      expect(parseOverview('Adds guided review.')).toBe('Adds guided review.');
      expect(parseOverview('')).toBeUndefined();
      expect(parseOverview(3)).toBeUndefined();
    });
  });

  describe('[FR-PRREVIEW-210] parseGuideSource', () => {
    it('should accept the two known sources', () => {
      expect(parseGuideSource('default')).toBe('default');
      expect(parseGuideSource('project')).toBe('project');
    });

    it('should drop anything else', () => {
      expect(parseGuideSource('custom')).toBeUndefined();
      expect(parseGuideSource(null)).toBeUndefined();
    });
  });
});
