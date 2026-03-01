import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, type SpecFrontmatter } from './frontmatter';

describe('frontmatter', () => {
  describe('parseFrontmatter', () => {
    it('should parse valid frontmatter', () => {
      const content = [
        '---',
        'title: Auth Revamp',
        'status: draft',
        'type: buildable',
        '---',
        '# Auth Revamp',
        'Body content here.',
      ].join('\n');

      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        title: 'Auth Revamp',
        status: 'draft',
        type: 'buildable',
      });
      expect(result.body).toBe('# Auth Revamp\nBody content here.');
    });

    it('should return defaults for missing frontmatter', () => {
      const result = parseFrontmatter('# Just a heading');
      expect(result.frontmatter).toEqual({
        title: '',
        status: 'draft',
        type: 'buildable',
      });
      expect(result.body).toBe('# Just a heading');
    });

    it('should return defaults for invalid YAML without throwing', () => {
      const content = '---\n: invalid: yaml: [broken\n---\nBody';
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        title: '',
        status: 'draft',
        type: 'buildable',
      });
      expect(result.body).toBe('Body');
    });

    it('should handle empty content', () => {
      const result = parseFrontmatter('');
      expect(result.frontmatter).toEqual({
        title: '',
        status: 'draft',
        type: 'buildable',
      });
      expect(result.body).toBe('');
    });

    it('should handle frontmatter with no body', () => {
      const content = '---\ntitle: No Body\nstatus: ready\ntype: vision\n---\n';
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        title: 'No Body',
        status: 'ready',
        type: 'vision',
      });
      expect(result.body).toBe('');
    });

    it('should preserve extra fields in raw', () => {
      const content = '---\ntitle: Test\nstatus: draft\ntype: buildable\ncustomField: value\n---\nBody';
      const result = parseFrontmatter(content);
      expect(result.frontmatter.title).toBe('Test');
      expect(result.raw.customField).toBe('value');
    });
  });

  describe('serializeFrontmatter', () => {
    it('should serialize frontmatter and body', () => {
      const frontmatter: SpecFrontmatter = { title: 'Test', status: 'draft', type: 'buildable' };
      const result = serializeFrontmatter(frontmatter, '# Test\nBody.');
      expect(result).toContain('---\n');
      expect(result).toContain('title: Test');
      expect(result).toContain('status: draft');
      expect(result).toContain('type: buildable');
      expect(result).toContain('---\n# Test\nBody.');
    });

    it('should preserve extra fields when raw is provided', () => {
      const frontmatter: SpecFrontmatter = { title: 'Test', status: 'draft', type: 'buildable' };
      const raw = { title: 'Test', status: 'draft', type: 'buildable', customField: 'value' };
      const result = serializeFrontmatter(frontmatter, 'Body', raw);
      expect(result).toContain('customField: value');
    });
  });

  describe('round-trip', () => {
    it('should preserve content through parse-serialize cycle', () => {
      const original: SpecFrontmatter = { title: 'Round Trip', status: 'ready', type: 'vision' };
      const originalBody = '# Round Trip\n\nSome content here.\n\n## Section\n\nMore content.';

      const serialized = serializeFrontmatter(original, originalBody);
      const parsed = parseFrontmatter(serialized);

      expect(parsed.frontmatter).toEqual(original);
      expect(parsed.body).toBe(originalBody);
    });

    it('should preserve extra fields through round-trip', () => {
      const content = '---\ntitle: Extra\nstatus: draft\ntype: buildable\ncustomField: value\n---\nBody content';
      const parsed = parseFrontmatter(content);
      const reserialized = serializeFrontmatter(parsed.frontmatter, parsed.body, parsed.raw);
      const reparsed = parseFrontmatter(reserialized);

      expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
      expect(reparsed.body).toBe(parsed.body);
      expect(reparsed.raw.customField).toBe('value');
    });
  });
});
