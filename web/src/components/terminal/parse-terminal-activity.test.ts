import { describe, it, expect } from 'vitest';
import { parseTerminalActivity } from './parse-terminal-activity';

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

  describe('mixed content', () => {
    it('should return empty results for plain text', () => {
      const result = parseTerminalActivity('hello world\r\n');
      expect(result.titles).toEqual([]);
      expect(result.hasBell).toBe(false);
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
