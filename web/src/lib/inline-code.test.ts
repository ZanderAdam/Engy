import { describe, expect, it } from 'vitest';
import { inlineCodeSegments } from './inline-code';

describe('inline-code', () => {
  describe('[FR-PRREVIEW-350] inlineCodeSegments', () => {
    it('should split backtick spans out as code', () => {
      expect(inlineCodeSegments('Calls `auth()` before `body`.')).toEqual([
        { text: 'Calls ', code: false },
        { text: 'auth()', code: true },
        { text: ' before ', code: false },
        { text: 'body', code: true },
        { text: '.', code: false },
      ]);
    });

    it('should keep an unmatched backtick as text', () => {
      expect(inlineCodeSegments('a ` b')).toEqual([{ text: 'a ` b', code: false }]);
    });

    it('should return plain text as one segment', () => {
      expect(inlineCodeSegments('plain')).toEqual([{ text: 'plain', code: false }]);
    });
  });
});
