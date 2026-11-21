import { describe, it, expect } from 'vitest';
import { createTerminalActivityParser } from './parse-terminal-activity';

const parseTerminalActivity = (data: string) => createTerminalActivityParser().parse(data);

describe('createTerminalActivityParser (single chunk)', () => {
  describe('OSC title extraction', () => {
    it('should extract title from OSC 0 with BEL terminator', () => {
      expect(parseTerminalActivity('\x1b]0;my title\x07').titles).toEqual(['my title']);
    });

    it('should extract title from OSC 2 with BEL terminator', () => {
      expect(parseTerminalActivity('\x1b]2;my title\x07').titles).toEqual(['my title']);
    });

    it('should extract title from OSC 0 with ST terminator', () => {
      expect(parseTerminalActivity('\x1b]0;my title\x1b\\').titles).toEqual(['my title']);
    });

    it('should extract title from OSC 2 with ST terminator', () => {
      expect(parseTerminalActivity('\x1b]2;my title\x1b\\').titles).toEqual(['my title']);
    });

    it('should extract multiple titles from mixed content', () => {
      const data = 'some output\x1b]0;title one\x07more output\x1b]2;title two\x1b\\';
      expect(parseTerminalActivity(data).titles).toEqual(['title one', 'title two']);
    });

    it('should extract a title surrounded by standalone bells', () => {
      expect(parseTerminalActivity('\x07\x1b]0;title\x07\x07').titles).toEqual(['title']);
    });

    it('should handle empty title', () => {
      expect(parseTerminalActivity('\x1b]0;\x07').titles).toEqual(['']);
    });

    it('should ignore an OSC 8 hyperlink sequence', () => {
      expect(parseTerminalActivity('\x1b]8;params;url\x07').titles).toEqual([]);
    });
  });

  describe('mixed content', () => {
    it('should return empty results for plain text', () => {
      const result = parseTerminalActivity('hello world\r\n');
      expect(result.titles).toEqual([]);
    });

    it('should handle data with ANSI escape sequences but no OSC', () => {
      expect(parseTerminalActivity('\x1b[32mgreen text\x1b[0m').titles).toEqual([]);
    });

    it('should handle title with special characters', () => {
      const result = parseTerminalActivity('\x1b]0;~/dev/project (main) ⠋ Building...\x07');
      expect(result.titles).toEqual(['~/dev/project (main) ⠋ Building...']);
    });

    it('should handle malformed OSC without semicolon followed by valid OSC', () => {
      const data = '\x1b]8no-semi-here\x07\x1b]0;real title\x07';
      expect(parseTerminalActivity(data).titles).toEqual(['real title']);
    });

    it('should handle unterminated OSC at end of data', () => {
      expect(parseTerminalActivity('\x1b]0;partial title').titles).toEqual([]);
    });
  });
});

describe('createTerminalActivityParser', () => {
  describe('split OSC sequences across chunks', () => {
    it('should parse a title sequence split after ESC ]', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('\x1b]').titles).toEqual([]);
      expect(parser.parse('0;my title\x07').titles).toEqual(['my title']);
    });

    it('should parse a title sequence split mid-body', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('\x1b]0;my ti').titles).toEqual([]);
      expect(parser.parse('tle\x07').titles).toEqual(['my title']);
    });

    it('should parse a title sequence split just before BEL terminator', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('\x1b]0;my title').titles).toEqual([]);
      expect(parser.parse('\x07').titles).toEqual(['my title']);
    });

    it('should join the split halves of a title verbatim', () => {
      const parser = createTerminalActivityParser();
      parser.parse('\x1b]0;title part');
      expect(parser.parse('rest\x07').titles).toEqual(['title partrest']);
    });

    it('should parse a complete sequence in a single chunk on a reused parser', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('\x1b]0;full title\x07').titles).toEqual(['full title']);
    });

    it('should handle OSC split across three chunks', () => {
      const parser = createTerminalActivityParser();
      expect(parser.parse('\x1b]0;').titles).toEqual([]);
      expect(parser.parse('chunk').titles).toEqual([]);
      expect(parser.parse('title\x07').titles).toEqual(['chunktitle']);
    });
  });
});
