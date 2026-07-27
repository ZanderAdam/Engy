import { describe, it, expect } from 'vitest';
import { toBracketedPaste } from './bracketed-paste';

describe('terminal bracketed paste', () => {
  describe('toBracketedPaste', () => {
    it('[FR-TERMINAL-400] should wrap text in the paste sentinels', () => {
      expect(toBracketedPaste('hello')).toBe('\x1b[200~hello\x1b[201~');
    });

    it('[FR-TERMINAL-400] should send line breaks as carriage returns inside the paste', () => {
      expect(toBracketedPaste('first\nsecond')).toBe('\x1b[200~first\rsecond\x1b[201~');
    });

    it('[FR-TERMINAL-400] should normalise CRLF line breaks', () => {
      expect(toBracketedPaste('first\r\nsecond')).toBe('\x1b[200~first\rsecond\x1b[201~');
    });

    it('[FR-TERMINAL-400] should strip sentinels so text cannot escape the paste', () => {
      const escaped = toBracketedPaste('safe\x1b[201~rm -rf /\x1b[200~ tail');
      expect(escaped).toBe('\x1b[200~saferm -rf / tail\x1b[201~');
      expect(escaped.match(/\x1b\[200~/g)).toHaveLength(1);
      expect(escaped.match(/\x1b\[201~/g)).toHaveLength(1);
    });
  });
});
