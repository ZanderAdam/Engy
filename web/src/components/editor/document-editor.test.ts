import { describe, it, expect } from 'vitest';
import { stripFrontmatter } from './frontmatter';

describe('stripFrontmatter', () => {
  describe('content with frontmatter', () => {
    it('should strip frontmatter and return header + body', () => {
      const input = '---\ntitle: Test\n---\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle: Test\n---\n');
      expect(result.body).toBe('# Body');
    });

    it('should handle multi-line frontmatter', () => {
      const input = '---\ntitle: Test\nstatus: active\ntags:\n  - a\n  - b\n---\n# Body\nContent';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle: Test\nstatus: active\ntags:\n  - a\n  - b\n---\n');
      expect(result.body).toBe('# Body\nContent');
    });

    it('should handle empty frontmatter block', () => {
      const input = '---\n---\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\n---\n');
      expect(result.body).toBe('# Body');
    });

    it('should preserve exact whitespace in frontmatter', () => {
      const input = '---\ntitle:   spaced  \n---\nContent';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle:   spaced  \n---\n');
      expect(result.body).toBe('Content');
    });
  });

  describe('content without frontmatter', () => {
    it('should return empty header and full content as body', () => {
      const input = '# Just a heading\nSome content';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('');
      expect(result.body).toBe('# Just a heading\nSome content');
    });

    it('should handle empty string', () => {
      const result = stripFrontmatter('');
      expect(result.header).toBe('');
      expect(result.body).toBe('');
    });
  });

  describe('unclosed frontmatter', () => {
    it('should treat unclosed delimiter as no frontmatter', () => {
      const input = '---\ntitle: Test\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('');
      expect(result.body).toBe('---\ntitle: Test\n# Body');
    });
  });

  describe('round-trip preservation', () => {
    it('should reconstruct original content from header + body', () => {
      const input = '---\ntitle: Test\nstatus: draft\n---\n# My Document\n\nSome content here.';
      const { header, body } = stripFrontmatter(input);
      expect(header + body).toBe(input);
    });

    it('should reconstruct content without frontmatter', () => {
      const input = '# No frontmatter\nJust content';
      const { header, body } = stripFrontmatter(input);
      expect(header + body).toBe(input);
    });
  });
});
