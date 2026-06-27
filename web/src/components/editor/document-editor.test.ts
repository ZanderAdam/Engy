import { describe, it, expect } from 'vitest';
import { stripFrontmatter } from './frontmatter';

describe('[FR-EDITOR-120] stripFrontmatter', () => {
  describe('content with frontmatter', () => {
    it('[FR-EDITOR-120] should strip frontmatter and return header + body', () => {
      const input = '---\ntitle: Test\n---\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle: Test\n---\n');
      expect(result.body).toBe('# Body');
    });

    it('[FR-EDITOR-120] should handle multi-line frontmatter', () => {
      const input = '---\ntitle: Test\nstatus: active\ntags:\n  - a\n  - b\n---\n# Body\nContent';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle: Test\nstatus: active\ntags:\n  - a\n  - b\n---\n');
      expect(result.body).toBe('# Body\nContent');
    });

    it('[FR-EDITOR-120] should handle empty frontmatter block', () => {
      const input = '---\n---\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\n---\n');
      expect(result.body).toBe('# Body');
    });

    it('[FR-EDITOR-120] should preserve exact whitespace in frontmatter', () => {
      const input = '---\ntitle:   spaced  \n---\nContent';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('---\ntitle:   spaced  \n---\n');
      expect(result.body).toBe('Content');
    });
  });

  describe('content without frontmatter', () => {
    it('[FR-EDITOR-120] should return empty header and full content as body', () => {
      const input = '# Just a heading\nSome content';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('');
      expect(result.body).toBe('# Just a heading\nSome content');
    });

    it('[FR-EDITOR-120] should handle empty string', () => {
      const result = stripFrontmatter('');
      expect(result.header).toBe('');
      expect(result.body).toBe('');
    });
  });

  describe('[FR-EDITOR-120] unclosed frontmatter', () => {
    it('[FR-EDITOR-120] should treat unclosed delimiter as no frontmatter', () => {
      const input = '---\ntitle: Test\n# Body';
      const result = stripFrontmatter(input);
      expect(result.header).toBe('');
      expect(result.body).toBe('---\ntitle: Test\n# Body');
    });
  });

  describe('[FR-EDITOR-120] round-trip preservation', () => {
    it('[FR-EDITOR-120] should reconstruct original content from header + body', () => {
      const input = '---\ntitle: Test\nstatus: draft\n---\n# My Document\n\nSome content here.';
      const { header, body } = stripFrontmatter(input);
      expect(header + body).toBe(input);
    });

    it('[FR-EDITOR-120] should reconstruct content without frontmatter', () => {
      const input = '# No frontmatter\nJust content';
      const { header, body } = stripFrontmatter(input);
      expect(header + body).toBe(input);
    });
  });
});
