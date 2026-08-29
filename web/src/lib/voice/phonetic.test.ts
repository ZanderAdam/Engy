import { describe, it, expect } from 'vitest';
import type { DoubleMetaphoneCode } from './phonetic';
import { doubleMetaphone, editDistance, normalizeToken, phoneticSimilarity } from './phonetic';

describe('phonetic', () => {
  describe('normalizeToken', () => {
    it('should lowercase and strip everything but letters', () => {
      expect(normalizeToken('Engy-Web, ')).toBe('engyweb');
    });

    it('should return an empty string for input with no letters', () => {
      expect(normalizeToken('42!')).toBe('');
    });
  });

  describe('doubleMetaphone', () => {
    it('should return empty codes for a value with no letters', () => {
      expect(doubleMetaphone('123')).toEqual({ primary: '', secondary: '' });
    });

    it('should produce the same primary code for classic sound-alike spellings', () => {
      expect(doubleMetaphone('smith').primary).toBe(doubleMetaphone('smyth').primary);
    });

    it('should encode an ambiguous soft/hard G as a primary/secondary pair', () => {
      const codes: DoubleMetaphoneCode = doubleMetaphone('engy');
      expect(codes.primary).not.toBe(codes.secondary);
      expect(typeof codes.primary).toBe('string');
      expect(typeof codes.secondary).toBe('string');
    });

    it('should drop a silent leading letter in GN/KN/PN/WR/PS clusters', () => {
      expect(doubleMetaphone('knight').primary.startsWith('K')).toBe(false);
    });
  });

  describe('editDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(editDistance('engy', 'engy')).toBe(0);
    });

    it('should return the length of the other string when one is empty', () => {
      expect(editDistance('', 'engy')).toBe(4);
      expect(editDistance('engy', '')).toBe(4);
    });

    it('should count substitutions, insertions and deletions', () => {
      expect(editDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('phoneticSimilarity', () => {
    it('should score identical words as 1', () => {
      expect(phoneticSimilarity('engy', 'engy')).toBe(1);
    });

    it('should score an unrelated word much lower than the match threshold', () => {
      expect(phoneticSimilarity('help', 'unrelated request completely')).toBeLessThan(0.4);
    });

    it.each([
      ['engie web', 1],
      ['n g web', 0.75],
      ['energy web', 0.75],
    ])(
      '[FR-TG2.3] should score the STT mangle "%s" of "engy-web" above the match threshold',
      (mangled, minScore) => {
        expect(phoneticSimilarity('engy-web', mangled)).toBeGreaterThanOrEqual(minScore);
      },
    );
  });
});
