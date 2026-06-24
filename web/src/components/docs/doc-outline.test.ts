import { describe, expect, it } from 'vitest';
import { extractOutline, headingsEqual } from './doc-outline';

const text = (s: string) => [{ type: 'text', text: s, styles: {} }];

describe('document outline', () => {
  describe('extractOutline', () => {
    it('should collect headings in document order with level and text', () => {
      const blocks = [
        { id: 'a', type: 'heading', props: { level: 1 }, content: text('Alpha') },
        { id: 'b', type: 'paragraph', content: text('body') },
        { id: 'c', type: 'heading', props: { level: 2 }, content: text('Beta') },
      ];

      expect(extractOutline(blocks)).toEqual([
        { id: 'a', level: 1, text: 'Alpha' },
        { id: 'c', level: 2, text: 'Beta' },
      ]);
    });

    it('should default to level 1 when level prop is missing', () => {
      const blocks = [{ id: 'a', type: 'heading', props: {}, content: text('No level') }];
      expect(extractOutline(blocks)).toEqual([{ id: 'a', level: 1, text: 'No level' }]);
    });

    it('should join mixed inline content including link text', () => {
      const blocks = [
        {
          id: 'a',
          type: 'heading',
          props: { level: 3 },
          content: [
            { type: 'text', text: 'See ', styles: {} },
            { type: 'link', content: text('the docs') },
            { type: 'text', text: ' now', styles: {} },
          ],
        },
      ];
      expect(extractOutline(blocks)).toEqual([{ id: 'a', level: 3, text: 'See the docs now' }]);
    });

    it('should recurse into child blocks', () => {
      const blocks = [
        {
          id: 'col',
          type: 'column',
          children: [{ id: 'nested', type: 'heading', props: { level: 2 }, content: text('Nested') }],
        },
      ];
      expect(extractOutline(blocks)).toEqual([{ id: 'nested', level: 2, text: 'Nested' }]);
    });

    it('should skip headings with empty or whitespace-only text', () => {
      const blocks = [
        { id: 'a', type: 'heading', props: { level: 1 }, content: text('   ') },
        { id: 'b', type: 'heading', props: { level: 1 }, content: [] },
      ];
      expect(extractOutline(blocks)).toEqual([]);
    });

    it('should skip headings missing an id (no scroll target)', () => {
      const blocks = [{ type: 'heading', props: { level: 1 }, content: text('Orphan') }];
      expect(extractOutline(blocks)).toEqual([]);
    });

    it('should trim surrounding whitespace from heading text', () => {
      const blocks = [{ id: 'a', type: 'heading', props: { level: 1 }, content: text('  Spaced  ') }];
      expect(extractOutline(blocks)).toEqual([{ id: 'a', level: 1, text: 'Spaced' }]);
    });

    it('should return an empty outline for a document with no headings', () => {
      expect(extractOutline([{ id: 'a', type: 'paragraph', content: text('body') }])).toEqual([]);
    });

    it('should emit a heading before recursing into its children', () => {
      const blocks = [
        {
          id: 'parent',
          type: 'heading',
          props: { level: 1 },
          content: text('Parent'),
          children: [{ id: 'child', type: 'heading', props: { level: 2 }, content: text('Child') }],
        },
      ];
      expect(extractOutline(blocks)).toEqual([
        { id: 'parent', level: 1, text: 'Parent' },
        { id: 'child', level: 2, text: 'Child' },
      ]);
    });
  });

  describe('headingsEqual', () => {
    const h = (id: string, level: number, text: string) => ({ id, level, text });

    it('should treat identical outlines as equal', () => {
      expect(headingsEqual([h('a', 1, 'A'), h('b', 2, 'B')], [h('a', 1, 'A'), h('b', 2, 'B')])).toBe(
        true,
      );
    });

    it('should detect differing length, id, level, or text', () => {
      expect(headingsEqual([h('a', 1, 'A')], [])).toBe(false);
      expect(headingsEqual([h('a', 1, 'A')], [h('b', 1, 'A')])).toBe(false);
      expect(headingsEqual([h('a', 1, 'A')], [h('a', 2, 'A')])).toBe(false);
      expect(headingsEqual([h('a', 1, 'A')], [h('a', 1, 'Z')])).toBe(false);
    });

    it('should treat two empty outlines as equal', () => {
      expect(headingsEqual([], [])).toBe(true);
    });
  });
});
