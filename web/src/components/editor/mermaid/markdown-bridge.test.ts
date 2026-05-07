import { describe, it, expect } from 'vitest';
import { codeBlockToMermaid, mermaidToCodeBlock } from './markdown-bridge';

type Block = {
  type: string;
  props?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string; styles?: Record<string, unknown> }>;
  children?: Block[];
};

const mermaidCode = (lang: string, text: string): Block => ({
  type: 'codeBlock',
  props: { language: lang },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});

const mermaidBlock = (code: string): Block => ({
  type: 'mermaid',
  props: { code },
  content: [],
  children: [],
});

const para = (text: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});

describe('markdown-bridge', () => {
  describe('codeBlockToMermaid', () => {
    it('returns empty array unchanged', () => {
      expect(codeBlockToMermaid([])).toEqual([]);
    });

    it('converts a mermaid code block to a mermaid block', () => {
      const result = codeBlockToMermaid([mermaidCode('mermaid', 'flowchart TD\n  A --> B')]);
      expect(result).toEqual([
        {
          type: 'mermaid',
          props: { code: 'flowchart TD\n  A --> B' },
          content: [],
          children: [],
        },
      ]);
    });

    it('leaves non-mermaid code blocks alone', () => {
      const input = [mermaidCode('typescript', 'const x = 1;')];
      const result = codeBlockToMermaid(input);
      expect(result).toEqual(input);
    });

    it('leaves code blocks with no language alone', () => {
      const input = [mermaidCode('', 'plain text')];
      const result = codeBlockToMermaid(input);
      expect(result).toEqual(input);
    });

    it('handles mermaid code blocks mixed with other blocks', () => {
      const input: Block[] = [
        para('Before'),
        mermaidCode('mermaid', 'sequenceDiagram\n  A->>B: hi'),
        para('Between'),
        mermaidCode('typescript', 'const x = 1;'),
        para('After'),
      ];
      const result = codeBlockToMermaid(input);
      expect(result[0]).toEqual(input[0]);
      expect(result[1]).toEqual(mermaidBlock('sequenceDiagram\n  A->>B: hi'));
      expect(result[2]).toEqual(input[2]);
      expect(result[3]).toEqual(input[3]);
      expect(result[4]).toEqual(input[4]);
    });

    it('recurses into children (nested in toggles, lists, etc)', () => {
      const input: Block[] = [
        {
          type: 'bulletListItem',
          props: {},
          content: [{ type: 'text', text: 'Item with diagram', styles: {} }],
          children: [mermaidCode('mermaid', 'graph LR\n  A-->B')],
        },
      ];
      const result = codeBlockToMermaid(input);
      expect(result[0].children?.[0]).toEqual(mermaidBlock('graph LR\n  A-->B'));
    });

    it('handles a code block with empty content', () => {
      const input: Block[] = [
        { type: 'codeBlock', props: { language: 'mermaid' }, content: [], children: [] },
      ];
      const result = codeBlockToMermaid(input);
      expect(result).toEqual([mermaidBlock('')]);
    });

    it('joins multiple text inline nodes within the code block', () => {
      const input: Block[] = [
        {
          type: 'codeBlock',
          props: { language: 'mermaid' },
          content: [
            { type: 'text', text: 'flowchart TD\n', styles: {} },
            { type: 'text', text: '  A --> B', styles: {} },
          ],
          children: [],
        },
      ];
      const result = codeBlockToMermaid(input);
      expect(result).toEqual([mermaidBlock('flowchart TD\n  A --> B')]);
    });
  });

  describe('mermaidToCodeBlock', () => {
    it('returns empty array unchanged', () => {
      expect(mermaidToCodeBlock([])).toEqual([]);
    });

    it('converts a mermaid block to a mermaid code block', () => {
      const result = mermaidToCodeBlock([mermaidBlock('flowchart TD\n  A --> B')]);
      expect(result).toEqual([
        {
          type: 'codeBlock',
          props: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart TD\n  A --> B', styles: {} }],
          children: [],
        },
      ]);
    });

    it('leaves other blocks alone', () => {
      const input: Block[] = [
        para('hello'),
        mermaidCode('typescript', 'const x = 1;'),
      ];
      expect(mermaidToCodeBlock(input)).toEqual(input);
    });

    it('handles an empty-source mermaid block', () => {
      const result = mermaidToCodeBlock([mermaidBlock('')]);
      expect(result).toEqual([
        {
          type: 'codeBlock',
          props: { language: 'mermaid' },
          content: [],
          children: [],
        },
      ]);
    });

    it('recurses into children', () => {
      const input: Block[] = [
        {
          type: 'bulletListItem',
          props: {},
          content: [{ type: 'text', text: 'Item', styles: {} }],
          children: [mermaidBlock('graph LR\n  A-->B')],
        },
      ];
      const result = mermaidToCodeBlock(input);
      expect(result[0].children?.[0]).toEqual(
        mermaidCode('mermaid', 'graph LR\n  A-->B'),
      );
    });
  });

  describe('idempotency', () => {
    it('mermaidToCodeBlock(codeBlockToMermaid(x)) preserves mermaid blocks', () => {
      const input: Block[] = [
        para('Before'),
        mermaidCode('mermaid', 'flowchart TD\n  A --> B'),
        para('After'),
      ];
      const result = mermaidToCodeBlock(codeBlockToMermaid(input));
      expect(result).toEqual(input);
    });

    it('codeBlockToMermaid(mermaidToCodeBlock(x)) preserves mermaid blocks', () => {
      const input: Block[] = [
        para('Before'),
        mermaidBlock('flowchart TD\n  A --> B'),
        para('After'),
      ];
      const result = codeBlockToMermaid(mermaidToCodeBlock(input));
      expect(result).toEqual(input);
    });
  });
});
