import { describe, it, expect } from 'vitest';
import { parseBrowsePath, filterDirs, pickAutocompleteMatch } from './dir-path-input.helpers';

describe('parseBrowsePath', () => {
  describe('empty input', () => {
    it('should return empty browsePath and filter', () => {
      expect(parseBrowsePath('')).toEqual({ browsePath: '', filter: '' });
    });
  });

  describe('trailing slash', () => {
    it('should treat the full input as the browsePath with no filter', () => {
      expect(parseBrowsePath('/Users/aleks/')).toEqual({ browsePath: '/Users/aleks', filter: '' });
    });

    it('should return "/" for root with trailing slash', () => {
      expect(parseBrowsePath('/')).toEqual({ browsePath: '/', filter: '' });
    });
  });

  describe('mid-segment input', () => {
    it('should split at the last "/" giving dirname as browsePath and basename as filter', () => {
      expect(parseBrowsePath('/Users/aleks/de')).toEqual({
        browsePath: '/Users/aleks',
        filter: 'de',
      });
    });

    it('should handle a single path segment with no parent slash', () => {
      expect(parseBrowsePath('foo')).toEqual({ browsePath: '.', filter: 'foo' });
    });

    it('should handle nested paths', () => {
      expect(parseBrowsePath('/a/b/c')).toEqual({ browsePath: '/a/b', filter: 'c' });
    });
  });

  describe('root "/"', () => {
    it('should return "/" browsePath and empty filter when input is "/"', () => {
      expect(parseBrowsePath('/')).toEqual({ browsePath: '/', filter: '' });
    });
  });
});

describe('filterDirs', () => {
  const dirs = ['Documents', '.hidden', 'Downloads', 'dev', 'Desktop', '.git'];

  describe('dot-directory filtering', () => {
    it('should exclude directories starting with "."', () => {
      const result = filterDirs(dirs, '');
      expect(result).not.toContain('.hidden');
      expect(result).not.toContain('.git');
    });

    it('should include all visible dirs when filter is empty', () => {
      const result = filterDirs(dirs, '');
      expect(result).toEqual(['Documents', 'Downloads', 'dev', 'Desktop']);
    });
  });

  describe('case-insensitive substring filter', () => {
    it('should match case-insensitively', () => {
      const result = filterDirs(dirs, 'doc');
      expect(result).toContain('Documents');
    });

    it('should match uppercase filter against lowercase dir', () => {
      const result = filterDirs(dirs, 'DEV');
      expect(result).toContain('dev');
    });

    it('should return empty array when nothing matches', () => {
      const result = filterDirs(dirs, 'xyz');
      expect(result).toEqual([]);
    });

    it('should exclude dot-dirs even if filter matches them', () => {
      const result = filterDirs(dirs, 'hidden');
      expect(result).toEqual([]);
    });

    it('should filter and exclude dot-dirs simultaneously', () => {
      const result = filterDirs(dirs, 'de');
      expect(result).toContain('dev');
      expect(result).toContain('Desktop');
      expect(result).not.toContain('.hidden');
    });
  });
});

describe('pickAutocompleteMatch', () => {
  describe('exact match', () => {
    it('should prefer an exact case-insensitive match over single-match', () => {
      const result = pickAutocompleteMatch(['Documents', 'DocumentsOld'], 'documents');
      expect(result).toBe('Documents');
    });

    it('should return exact match when casing differs', () => {
      const result = pickAutocompleteMatch(['Documents'], 'DOCUMENTS');
      expect(result).toBe('Documents');
    });
  });

  describe('single match fallback', () => {
    it('should return the only entry when there is no exact match', () => {
      const result = pickAutocompleteMatch(['Downloads'], 'down');
      expect(result).toBe('Downloads');
    });
  });

  describe('no match', () => {
    it('should return null when multiple entries and no exact match', () => {
      const result = pickAutocompleteMatch(['dev', 'Desktop'], 'de');
      expect(result).toBeNull();
    });

    it('should return null for an empty filtered list', () => {
      const result = pickAutocompleteMatch([], 'xyz');
      expect(result).toBeNull();
    });

    it('should return null when filter is empty', () => {
      const result = pickAutocompleteMatch(['Documents'], '');
      expect(result).toBeNull();
    });
  });
});
