/**
 * @vitest-environment jsdom
 *
 * Round-trip test: feed comprehensive markdown into BlockNote, serialize it back,
 * and diff the result. This reveals every formatting change BlockNote makes so we
 * can build a targeted post-processor.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { normalizeMarkdown } from './remark-normalize';

/* ------------------------------------------------------------------ */
/*  Comprehensive markdown fixture — every common construct            */
/* ------------------------------------------------------------------ */

const FIXTURE = `# Heading 1

## Heading 2

### Heading 3

#### Heading 4

Regular paragraph with **bold**, *italic*, ***bold italic***, ~~strikethrough~~, and \`inline code\`.

---

Another paragraph after a horizontal rule using dashes.

***

Horizontal rule using asterisks above.

___

Horizontal rule using underscores above.

## Ordered Lists

1. First item
2. Second item
3. Third item

## Ordered List (starting at 5)

5. Fifth item
6. Sixth item
7. Seventh item

## Unordered Lists (dash)

- Apple
- Banana
- Cherry

## Unordered Lists (asterisk)

* Alpha
* Beta
* Gamma

## Unordered Lists (plus)

+ One
+ Two
+ Three

## Nested Lists

- Parent item
  - Child item
  - Another child
    - Grandchild
- Back to parent

1. First
   1. Nested first
   2. Nested second
2. Second

## Checkboxes

- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked

## Tables

| Name | Age | City |
| --- | --- | --- |
| Alice | 30 | NYC |
| Bob | 25 | LA |

## Table without alignment

| Col A | Col B | Col C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |

## Blockquotes

> Single line quote

> Multi line quote
> that continues here
> and here.

> Nested quote
>
> > Inner quote
>
> Back to outer

## Code Blocks

\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

\`\`\`
Plain code block without language
const x = 42;
\`\`\`

## Links and Images

[Link text](https://example.com)

[Link with title](https://example.com "Example Title")

![Alt text](https://example.com/image.png)

## Inline Formatting Combinations

This has **bold with *nested italic* inside** it.

This has *italic with **nested bold** inside* it.

A paragraph with \`code\`, **bold**, and *italic* all mixed together.

## Multiple Paragraphs

First paragraph.

Second paragraph.

Third paragraph with a longer body of text that spans what would normally be a single line in a markdown file.

## Emphasis Edge Cases

**Bold at start** of line.

End of line is **bold**.

Middle has **bold** word.

*Single asterisk italic* vs _underscore italic_.

**Double asterisk bold** vs __underscore bold__.

## Escaped Characters

This has a literal \\* asterisk and a \\[ bracket.

## Empty Sections

## Non-empty After Empty

Content after an empty heading section.
`;

/* ------------------------------------------------------------------ */
/*  Test suite                                                        */
/* ------------------------------------------------------------------ */

let editor: ReturnType<typeof BlockNoteEditor.create>;

beforeAll(() => {
  editor = BlockNoteEditor.create();
});

describe('BlockNote markdown round-trip', () => {
  it('should show all formatting differences (run with --reporter=verbose to inspect)', () => {
    const blocks = editor.tryParseMarkdownToBlocks(FIXTURE);
    const output = editor.blocksToMarkdownLossy(blocks);

    // Print both for easy diffing when the test is run
    const inputLines = FIXTURE.trimEnd().split('\n');
    const outputLines = output.trimEnd().split('\n');

    const diffs: string[] = [];

    const maxLen = Math.max(inputLines.length, outputLines.length);
    for (let i = 0; i < maxLen; i++) {
      const inp = inputLines[i] ?? '<missing>';
      const out = outputLines[i] ?? '<missing>';
      if (inp !== out) {
        diffs.push(`Line ${i + 1}:\n  IN:  ${JSON.stringify(inp)}\n  OUT: ${JSON.stringify(out)}`);
      }
    }

    if (diffs.length > 0) {
      // This is the actual value of the test — seeing every difference
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║  BlockNote Markdown Round-Trip Differences               ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
      console.log(`Found ${diffs.length} line differences:\n`);
      console.log(diffs.join('\n\n'));
      console.log('\n───────────────────────────────────────────────────────────');
      console.log('Full output:\n');
      console.log(output);
    }

    // We EXPECT differences — this test documents them, not prevents them.
    // Snapshot the output so future BlockNote upgrades show if things change.
    expect(output).toMatchSnapshot('blocknote-markdown-roundtrip');
  });

  it('should document list formatting changes', () => {
    const input = `- Apple\n- Banana\n- Cherry`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Lists] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('list-roundtrip');
  });

  it('should document ordered list formatting changes', () => {
    const input = `1. First\n2. Second\n3. Third`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Ordered Lists] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('ordered-list-roundtrip');
  });

  it('should document table formatting changes', () => {
    const input = `| Name | Age |\n| --- | --- |\n| Alice | 30 |`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Tables] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('table-roundtrip');
  });

  it('should document horizontal rule formatting changes', () => {
    const input = `Above\n\n---\n\nBelow`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[HR ---] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    const input2 = `Above\n\n***\n\nBelow`;
    const blocks2 = editor.tryParseMarkdownToBlocks(input2);
    const output2 = editor.blocksToMarkdownLossy(blocks2).trimEnd();

    console.log('\n[HR ***] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input2));
    console.log('  OUT:', JSON.stringify(output2));

    const input3 = `Above\n\n___\n\nBelow`;
    const blocks3 = editor.tryParseMarkdownToBlocks(input3);
    const output3 = editor.blocksToMarkdownLossy(blocks3).trimEnd();

    console.log('\n[HR ___] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input3));
    console.log('  OUT:', JSON.stringify(output3));

    expect(output).toMatchSnapshot('hr-dashes');
    expect(output2).toMatchSnapshot('hr-asterisks');
    expect(output3).toMatchSnapshot('hr-underscores');
  });

  it('should document nested list formatting changes', () => {
    const input = `- Parent\n  - Child\n  - Child 2\n    - Grandchild\n- Back`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Nested Lists] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('nested-list-roundtrip');
  });

  it('should document blockquote formatting changes', () => {
    const input = `> Line one\n> Line two\n> Line three`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Blockquotes] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('blockquote-roundtrip');
  });

  it('should document checkbox formatting changes', () => {
    const input = `- [ ] Unchecked\n- [x] Checked\n- [ ] Another`;
    const blocks = editor.tryParseMarkdownToBlocks(input);
    const output = editor.blocksToMarkdownLossy(blocks).trimEnd();

    console.log('\n[Checkboxes] Input vs Output:');
    console.log('  IN: ', JSON.stringify(input));
    console.log('  OUT:', JSON.stringify(output));

    expect(output).toMatchSnapshot('checkbox-roundtrip');
  });

  it('should document emphasis/bold style changes', () => {
    const tests = [
      { label: 'bold **', input: 'This is **bold** text' },
      { label: 'bold __', input: 'This is __bold__ text' },
      { label: 'italic *', input: 'This is *italic* text' },
      { label: 'italic _', input: 'This is _italic_ text' },
      { label: 'strikethrough', input: 'This is ~~struck~~ text' },
      { label: 'bold+italic ***', input: 'This is ***both*** text' },
    ];

    console.log('\n[Emphasis styles]:');
    for (const t of tests) {
      const blocks = editor.tryParseMarkdownToBlocks(t.input);
      const output = editor.blocksToMarkdownLossy(blocks).trimEnd();
      const changed = t.input !== output ? ' ← CHANGED' : '';
      console.log(`  [${t.label}] "${t.input}" → "${output}"${changed}`);
    }
  });

  it('should document second round-trip stability', () => {
    // Does a second round-trip produce the same output? (idempotency)
    const blocks1 = editor.tryParseMarkdownToBlocks(FIXTURE);
    const output1 = editor.blocksToMarkdownLossy(blocks1);

    const blocks2 = editor.tryParseMarkdownToBlocks(output1);
    const output2 = editor.blocksToMarkdownLossy(blocks2);

    const stable = output1 === output2;
    console.log(`\n[Idempotency] Second round-trip produces same output: ${stable}`);

    if (!stable) {
      const lines1 = output1.split('\n');
      const lines2 = output2.split('\n');
      const diffs: string[] = [];
      const maxLen = Math.max(lines1.length, lines2.length);
      for (let i = 0; i < maxLen; i++) {
        if (lines1[i] !== lines2[i]) {
          diffs.push(
            `Line ${i + 1}:\n  RT1: ${JSON.stringify(lines1[i] ?? '<missing>')}\n  RT2: ${JSON.stringify(lines2[i] ?? '<missing>')}`,
          );
        }
      }
      console.log(`  ${diffs.length} lines differ between RT1 and RT2:\n`);
      console.log(diffs.join('\n'));
    }

    // BlockNote's output is NOT idempotent — blockquotes grow `> \` lines each cycle.
    // Snapshot this so we track if it gets worse or better.
    expect(output2).toMatchSnapshot('second-roundtrip');
  });

  it('should be idempotent when using remark normalization', () => {
    const blocks1 = editor.tryParseMarkdownToBlocks(FIXTURE);
    const raw1 = editor.blocksToMarkdownLossy(blocks1);
    const normalized1 = normalizeMarkdown(raw1);

    const blocks2 = editor.tryParseMarkdownToBlocks(normalized1);
    const raw2 = editor.blocksToMarkdownLossy(blocks2);
    const normalized2 = normalizeMarkdown(raw2);

    const stable = normalized1 === normalized2;
    console.log(`\n[Remark idempotency] Second round-trip stable: ${stable}`);

    if (!stable) {
      const lines1 = normalized1.split('\n');
      const lines2 = normalized2.split('\n');
      const diffs: string[] = [];
      const maxLen = Math.max(lines1.length, lines2.length);
      for (let i = 0; i < maxLen; i++) {
        if (lines1[i] !== lines2[i]) {
          diffs.push(
            `Line ${i + 1}:\n  N1: ${JSON.stringify(lines1[i] ?? '<missing>')}\n  N2: ${JSON.stringify(lines2[i] ?? '<missing>')}`,
          );
        }
      }
      console.log(`  ${diffs.length} lines differ:\n`);
      console.log(diffs.join('\n'));
    }

    expect(normalized2).toBe(normalized1);
  });

  it('should show normalized output vs original input', () => {
    const blocks = editor.tryParseMarkdownToBlocks(FIXTURE);
    const raw = editor.blocksToMarkdownLossy(blocks);
    const normalized = normalizeMarkdown(raw).trimEnd();

    const inputLines = FIXTURE.trimEnd().split('\n');
    const outputLines = normalized.split('\n');

    const diffs: string[] = [];
    const maxLen = Math.max(inputLines.length, outputLines.length);
    for (let i = 0; i < maxLen; i++) {
      const inp = inputLines[i] ?? '<missing>';
      const out = outputLines[i] ?? '<missing>';
      if (inp !== out) {
        diffs.push(`Line ${i + 1}:\n  IN:  ${JSON.stringify(inp)}\n  OUT: ${JSON.stringify(out)}`);
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  Remark-Normalized Round-Trip Differences                ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    console.log(`Found ${diffs.length} line differences (vs ${133} without normalization):\n`);
    if (diffs.length > 0) console.log(diffs.join('\n\n'));

    expect(normalized).toMatchSnapshot('normalized-roundtrip');
  });
});
