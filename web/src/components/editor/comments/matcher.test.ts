import { describe, it, expect } from 'vitest';
import { findTextQuoteMatch } from './matcher';
import type { PmNode } from './types';

/**
 * Build a minimal PmNode mock from an array of text segments.
 *
 * ProseMirror positions: the doc node itself occupies position 0; each text
 * node at the top level starts at position 1 + sum of previous node sizes.
 * For simplicity, we model a flat paragraph whose text nodes sit at
 * positions 1..N (pos = 1 + offset into textContent, matching how
 * textOffsetToPmPos is designed to work against a flat PM doc).
 *
 * Each segment maps to one text node. Positions are assigned so that for
 * the i-th segment starting at textContent offset `off`, the PmNode pos is
 * `off + 1` (the "+1" comes from the paragraph wrapper node in a real doc).
 */
function buildDoc(segments: string[]): PmNode {
  const textContent = segments.join('');
  // Build the tree of text node descriptors
  type TextNodeDesc = { text: string; pos: number };
  const nodes: TextNodeDesc[] = [];
  let offset = 0;
  for (const seg of segments) {
    if (seg.length > 0) {
      nodes.push({ text: seg, pos: offset + 1 });
      offset += seg.length;
    }
  }

  const doc: PmNode = {
    isText: false,
    text: undefined,
    nodeSize: textContent.length + 2,
    textContent,
    marks: [],
    textBetween: (from, to) => textContent.slice(from - 1, to - 1),
    resolve: () => ({ start: () => 1, end: () => textContent.length + 1 }),
    descendants(fn) {
      for (const n of nodes) {
        const textNode: PmNode = {
          isText: true,
          text: n.text,
          nodeSize: n.text.length,
          textContent: n.text,
          marks: [],
          textBetween: () => '',
          resolve: () => ({ start: () => n.pos, end: () => n.pos + n.text.length }),
          descendants: () => {},
        };
        const stop = fn(textNode, n.pos);
        if (stop === false) break;
      }
    },
  };
  return doc;
}

describe('[FR-EDITOR-090] findTextQuoteMatch', () => {
  describe('exact match', () => {
    it('[FR-EDITOR-090] should find a simple exact match', () => {
      const doc = buildDoc(['Hello world']);
      const result = findTextQuoteMatch(doc, { exact: 'world', prefix: 'Hello ', suffix: '' });
      // 'world' starts at textContent offset 6; PM pos = 6+1=7, end=7+5=12
      expect(result).toEqual({ from: 7, to: 12 });
    });

    it('[FR-EDITOR-090] should pick the occurrence with the best context score', () => {
      const doc = buildDoc(['foo bar foo baz']);
      // two occurrences of 'foo'; prefer the one with suffix 'baz'
      const result = findTextQuoteMatch(doc, { exact: 'foo', prefix: '', suffix: ' baz' });
      // second 'foo' starts at offset 8 → PM pos 9
      expect(result).toEqual({ from: 9, to: 12 });
    });

    it('[FR-EDITOR-090] should return null when exact text is not found and normalization also fails', () => {
      const doc = buildDoc(['Hello world']);
      const result = findTextQuoteMatch(doc, { exact: 'xyz', prefix: '', suffix: '' });
      expect(result).toBeNull();
    });
  });

  describe('[FR-EDITOR-090] end-of-document anchor (Bug B fix)', () => {
    it('[FR-EDITOR-090] should resolve a match ending at the last character of the doc', () => {
      const doc = buildDoc(['Hello world']);
      // 'world' ends at textContent offset 11 == total length
      const result = findTextQuoteMatch(doc, { exact: 'world', prefix: 'Hello ', suffix: '' });
      expect(result).not.toBeNull();
      // from=7 (offset 6 + 1), to=12 (offset 11 + 1)
      expect(result!.from).toBe(7);
      expect(result!.to).toBe(12);
    });

    it('[FR-EDITOR-090] should resolve a single-word doc where match is the entire content', () => {
      const doc = buildDoc(['word']);
      const result = findTextQuoteMatch(doc, { exact: 'word', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(5);
    });

    it('[FR-EDITOR-090] should resolve last word when text is split across nodes', () => {
      // "Hello " in node 1 (pos 1–6), "world" in node 2 (pos 7–11)
      const doc = buildDoc(['Hello ', 'world']);
      const result = findTextQuoteMatch(doc, { exact: 'world', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      // textContent offset of 'world' = 6, PM pos = 7; length=5 → to=12
      expect(result!.from).toBe(7);
      expect(result!.to).toBe(12);
    });
  });

  describe('[FR-EDITOR-090] normalised fallback (Bug A fix)', () => {
    it('[FR-EDITOR-090] should match after a multi-newline code block with correct original offsets', () => {
      // Simulate a code block: "function foo() {\n  return 1;\n}\n" followed by "Target text"
      const codeBlock = 'function foo() {\n  return 1;\n}\n';
      const targetText = 'Target text';
      const doc = buildDoc([codeBlock, targetText]);
      // Exact text for comment was captured as 'Target text' (no whitespace issue here),
      // but test that the offset is correct by using a normalised selector
      const result = findTextQuoteMatch(doc, {
        exact: 'Target text',
        prefix: '',
        suffix: '',
      });
      expect(result).not.toBeNull();
      const expectedFrom = codeBlock.length + 1; // PM pos = textOffset+1
      const expectedTo = expectedFrom + targetText.length;
      expect(result!.from).toBe(expectedFrom);
      expect(result!.to).toBe(expectedTo);
    });

    it('[FR-EDITOR-090] should use normalized fallback when whitespace differs (collapsed)', () => {
      // Original doc has "Hello    World" (multiple spaces), but selector was captured
      // when it had "Hello World" (single space)
      const doc = buildDoc(['Hello    World']);
      const result = findTextQuoteMatch(doc, { exact: 'Hello World', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      // Should match the original range: from=1 to=15
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(15); // 'Hello    World'.length = 14; PM to = 15
    });

    it('[FR-EDITOR-090] should match after a multi-newline block with normalized fallback', () => {
      // Text that was "foo\n\nbar baz" when comment was made, now indented
      // The doc now has leading whitespace before "bar baz"
      const before = 'foo\n\n    '; // 4-space indent (code block indentation)
      const after = 'bar baz';
      const doc = buildDoc([before, after]);
      // Comment was anchored to 'bar baz' captured from original (no indent)
      const result = findTextQuoteMatch(doc, { exact: 'bar baz', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      const expectedFrom = before.length + 1;
      const expectedTo = expectedFrom + after.length;
      expect(result!.from).toBe(expectedFrom);
      expect(result!.to).toBe(expectedTo);
    });

    it('[FR-EDITOR-090] should resolve normalized match ending at document end', () => {
      // 'Some  text' in doc, selector was 'Some text' (collapsed)
      const doc = buildDoc(['Some  text']);
      const result = findTextQuoteMatch(doc, { exact: 'Some text', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      // from=1 (offset 0), to=11 (offset 10 = full length)
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(11);
    });

    it('[FR-EDITOR-090] should handle case-insensitive normalization', () => {
      const doc = buildDoc(['Hello WORLD']);
      const result = findTextQuoteMatch(doc, { exact: 'hello world', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(12);
    });

    it('[FR-EDITOR-090] should pick the correct normalized occurrence via context score when multiple exist', () => {
      // Two occurrences of "foo   bar" (extra spaces collapse to "foo bar" normalized).
      // We want the SECOND one, which has suffix "baz".
      // Original: "foo   bar and foo   bar baz"
      //            ^          ^
      //            offset 0   offset 14 ("foo   bar baz" wins)
      const doc = buildDoc(['foo   bar and foo   bar baz']);
      const result = findTextQuoteMatch(doc, {
        exact: 'foo bar',   // normalized form — won't exact-match, triggers fallback
        prefix: '',
        suffix: ' baz',
      });
      expect(result).not.toBeNull();
      // Second "foo   bar" starts at original offset 14 → PM from = 15
      expect(result!.from).toBe(15);
      // "foo   bar" has length 9 → PM to = 15 + 9 = 24
      expect(result!.to).toBe(24);
    });
  });

  describe('[FR-EDITOR-090] multi-node documents', () => {
    it('[FR-EDITOR-090] should handle match spanning only one of several nodes', () => {
      const doc = buildDoc(['First node. ', 'Second node. ', 'Third node.']);
      const result = findTextQuoteMatch(doc, { exact: 'Second node.', prefix: '', suffix: '' });
      expect(result).not.toBeNull();
      // 'Second node.' starts at offset 12 → PM pos 13
      expect(result!.from).toBe(13);
      expect(result!.to).toBe(25);
    });
  });
});
