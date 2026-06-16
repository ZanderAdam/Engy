import { describe, it, expect } from 'vitest';
import { parseTerminalActivity, createTerminalActivityParser } from './parse-terminal-activity';

describe('parseTerminalActivity', () => {
  describe('OSC title extraction', () => {
    it('should extract title from OSC 0 with BEL terminator', () => {
      const result = parseTerminalActivity('\x1b]0;my title\x07');
      expect(result.titles).toEqual(['my title']);
      expect(result.hasBell).toBe(false);
    });

    it('should extract title from OSC 2 with BEL terminator', () => {
      const result = parseTerminalActivity('\x1b]2;my title\x07');
      expect(result.titles).toEqual(['my title']);
      expect(result.hasBell).toBe(false);
    });

    it('should extract title from OSC 0 with ST terminator', () => {
      const result = parseTerminalActivity('\x1b]0;my title\x1b\\');
      expect(result.titles).toEqual(['my title']);
      expect(result.hasBell).toBe(false);
    });

    it('should extract title from OSC 2 with ST terminator', () => {
      const result = parseTerminalActivity('\x1b]2;my title\x1b\\');
      expect(result.titles).toEqual(['my title']);
      expect(result.hasBell).toBe(false);
    });

    it('should extract multiple titles from mixed content', () => {
      const data = 'some output\x1b]0;title one\x07more output\x1b]2;title two\x1b\\';
      const result = parseTerminalActivity(data);
      expect(result.titles).toEqual(['title one', 'title two']);
    });

    it('should handle empty title', () => {
      const result = parseTerminalActivity('\x1b]0;\x07');
      expect(result.titles).toEqual(['']);
    });

    it('should ignore non-title OSC sequences', () => {
      // OSC 8 is hyperlinks, should be ignored
      const result = parseTerminalActivity('\x1b]8;params;url\x07');
      expect(result.titles).toEqual([]);
    });
  });

  describe('bell detection', () => {
    it('should detect standalone bell character', () => {
      const result = parseTerminalActivity('some output\x07');
      expect(result.hasBell).toBe(true);
    });

    it('should not detect bell inside OSC sequence as standalone bell', () => {
      // The BEL here terminates the OSC, it's not a standalone bell
      const result = parseTerminalActivity('\x1b]0;title\x07');
      expect(result.hasBell).toBe(false);
    });

    it('should detect bell after OSC sequence', () => {
      const result = parseTerminalActivity('\x1b]0;title\x07\x07');
      expect(result.titles).toEqual(['title']);
      expect(result.hasBell).toBe(true);
    });

    it('should detect bell before OSC sequence', () => {
      const result = parseTerminalActivity('\x07\x1b]0;title\x07');
      expect(result.titles).toEqual(['title']);
      expect(result.hasBell).toBe(true);
    });
  });

  describe('prompt detection', () => {
    it('should detect a (y/n) confirmation prompt', () => {
      expect(parseTerminalActivity('Overwrite file? (y/n) ').hasPrompt).toBe(true);
    });

    it('should detect a [Y/n] confirmation prompt', () => {
      expect(parseTerminalActivity('Proceed [Y/n]').hasPrompt).toBe(true);
    });

    it('should detect a "press enter to continue" prompt', () => {
      expect(parseTerminalActivity('Press Enter to continue...').hasPrompt).toBe(true);
    });

    it('should detect a numbered selection menu', () => {
      expect(parseTerminalActivity('\x1b[2m❯ 1. Yes\x1b[0m').hasPrompt).toBe(true);
    });

    it('should not flag a bare ❯ shell prompt as waiting', () => {
      expect(parseTerminalActivity('user@host ~/dev ❯ ').hasPrompt).toBe(false);
    });

    it('should not flag ordinary output as a prompt', () => {
      expect(parseTerminalActivity('Building project... done in 1.2s\r\n').hasPrompt).toBe(false);
    });
  });

  describe('mixed content', () => {
    it('should return empty results for plain text', () => {
      const result = parseTerminalActivity('hello world\r\n');
      expect(result.titles).toEqual([]);
      expect(result.hasBell).toBe(false);
      expect(result.hasPrompt).toBe(false);
    });

    it('should handle data with ANSI escape sequences but no OSC', () => {
      const result = parseTerminalActivity('\x1b[32mgreen text\x1b[0m');
      expect(result.titles).toEqual([]);
      expect(result.hasBell).toBe(false);
    });

    it('should handle title with special characters', () => {
      const result = parseTerminalActivity('\x1b]0;~/dev/project (main) ⠋ Building...\x07');
      expect(result.titles).toEqual(['~/dev/project (main) ⠋ Building...']);
    });

    it('should handle malformed OSC without semicolon followed by valid OSC', () => {
      const data = '\x1b]8no-semi-here\x07\x1b]0;real title\x07';
      const result = parseTerminalActivity(data);
      expect(result.titles).toEqual(['real title']);
    });

    it('should handle unterminated OSC at end of data', () => {
      const result = parseTerminalActivity('\x1b]0;partial title');
      expect(result.titles).toEqual([]);
      expect(result.hasBell).toBe(false);
    });
  });
});

describe('createTerminalActivityParser', () => {
  describe('split OSC sequences across chunks', () => {
    it('should parse a title sequence split after ESC ]', () => {
      const parser = createTerminalActivityParser();
      const r1 = parser.parse('\x1b]');
      const r2 = parser.parse('0;my title\x07');
      expect(r1.titles).toEqual([]);
      expect(r1.hasBell).toBe(false);
      expect(r2.titles).toEqual(['my title']);
      expect(r2.hasBell).toBe(false);
    });

    it('should parse a title sequence split mid-body', () => {
      const parser = createTerminalActivityParser();
      const r1 = parser.parse('\x1b]0;my ti');
      const r2 = parser.parse('tle\x07');
      expect(r1.titles).toEqual([]);
      expect(r1.hasBell).toBe(false);
      expect(r2.titles).toEqual(['my title']);
      expect(r2.hasBell).toBe(false);
    });

    it('should parse a title sequence split just before BEL terminator', () => {
      const parser = createTerminalActivityParser();
      const r1 = parser.parse('\x1b]0;my title');
      const r2 = parser.parse('\x07');
      expect(r1.titles).toEqual([]);
      expect(r2.titles).toEqual(['my title']);
      expect(r2.hasBell).toBe(false);
    });

    it('should not emit a phantom bell for the BEL that terminates a split OSC', () => {
      const parser = createTerminalActivityParser();
      parser.parse('\x1b]0;title part');
      const r2 = parser.parse('rest\x07');
      // The BEL here terminates the OSC — it should NOT count as a standalone bell
      expect(r2.hasBell).toBe(false);
      // 'title part' + 'rest' = 'title partrest' (space is part of the original title)
      expect(r2.titles).toEqual(['title partrest']);
    });

    it('should correctly detect a real standalone bell after a split OSC', () => {
      const parser = createTerminalActivityParser();
      parser.parse('\x1b]0;title');
      const r2 = parser.parse('\x07\x07');
      expect(r2.titles).toEqual(['title']);
      expect(r2.hasBell).toBe(true);
    });

    it('should handle multiple chunks with no OSC content', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('hello').hasBell).toBe(false);
      expect(parser.parse(' world').hasBell).toBe(false);
      expect(parser.parse('\x07').hasBell).toBe(true);
    });

    it('should parse a complete sequence in a single chunk like the stateless function', () => {
      const parser = createTerminalActivityParser();
      const result = parser.parse('\x1b]0;full title\x07');
      expect(result.titles).toEqual(['full title']);
      expect(result.hasBell).toBe(false);
    });

    it('should handle OSC split across three chunks', () => {
      const parser = createTerminalActivityParser();
      const r1 = parser.parse('\x1b]0;');
      const r2 = parser.parse('chunk');
      const r3 = parser.parse('title\x07');
      expect(r1.titles).toEqual([]);
      expect(r2.titles).toEqual([]);
      expect(r3.titles).toEqual(['chunktitle']);
      expect(r3.hasBell).toBe(false);
    });
  });
});
