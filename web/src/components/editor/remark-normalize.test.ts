/**
 * @vitest-environment jsdom
 *
 * Tests that remark normalization fixes BlockNote's formatting issues
 * and produces idempotent output.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { normalizeMarkdown } from './remark-normalize';

let editor: ReturnType<typeof BlockNoteEditor.create>;

function roundTrip(input: string): string {
  const blocks = editor.tryParseMarkdownToBlocks(input);
  const raw = editor.blocksToMarkdownLossy(blocks);
  return normalizeMarkdown(raw).trimEnd();
}

beforeAll(() => {
  editor = BlockNoteEditor.create();
});

describe('remark normalization of BlockNote output', () => {
  describe('lists', () => {
    it('should produce tight unordered lists (no blank lines)', () => {
      const result = roundTrip('- Apple\n- Banana\n- Cherry');
      expect(result).toBe('- Apple\n- Banana\n- Cherry');
    });

    it('should produce tight ordered lists', () => {
      const result = roundTrip('1. First\n2. Second\n3. Third');
      expect(result).toBe('1. First\n2. Second\n3. Third');
    });

    it('should normalize bullet markers to dash', () => {
      const result = roundTrip('* Alpha\n* Beta');
      expect(result).toBe('- Alpha\n- Beta');
    });

    it('should handle nested lists', () => {
      const result = roundTrip('- Parent\n  - Child\n  - Child 2\n- Back');
      expect(result).toBe('- Parent\n  - Child\n  - Child 2\n- Back');
    });

    it('should handle checkboxes', () => {
      const result = roundTrip('- [ ] Unchecked\n- [x] Checked');
      expect(result).toBe('- [ ] Unchecked\n- [x] Checked');
    });
  });

  describe('horizontal rules', () => {
    it('should normalize --- to configured rule style', () => {
      const result = roundTrip('Above\n\n---\n\nBelow');
      expect(result).toBe('Above\n\n---\n\nBelow');
    });

    it('should normalize *** to configured rule style', () => {
      const result = roundTrip('Above\n\n***\n\nBelow');
      expect(result).toBe('Above\n\n---\n\nBelow');
    });

    it('should normalize ___ to configured rule style', () => {
      const result = roundTrip('Above\n\n___\n\nBelow');
      expect(result).toBe('Above\n\n---\n\nBelow');
    });
  });

  describe('tables', () => {
    it('should preserve table structure', () => {
      const result = roundTrip('| Name | Age |\n| --- | --- |\n| Alice | 30 |');
      // remark-gfm will pad columns — that's fine, it's consistent
      expect(result).toContain('| Name');
      expect(result).toContain('| Alice');
      expect(result).not.toContain('||'); // no collapsed columns
    });
  });

  describe('blockquotes', () => {
    it('should handle single-line blockquotes', () => {
      const result = roundTrip('> Single line quote');
      expect(result).toBe('> Single line quote');
    });

    it('should handle multi-line blockquotes', () => {
      const result = roundTrip('> Line one\n> Line two\n> Line three');
      console.log('[Blockquote multi-line after RT1]:', JSON.stringify(result));

      // Key test: is a second round-trip stable? (BlockNote without remark grows `> \` lines)
      const blocks2 = editor.tryParseMarkdownToBlocks(result);
      const raw2 = editor.blocksToMarkdownLossy(blocks2);
      const result2 = normalizeMarkdown(raw2).trimEnd();
      console.log('[Blockquote multi-line after RT2]:', JSON.stringify(result2));

      expect(result2).toBe(result);
    });
  });

  describe('code blocks', () => {
    it('should preserve code block content', () => {
      const result = roundTrip('```typescript\nconst x = 1;\n```');
      expect(result).toContain('```typescript');
      expect(result).toContain('const x = 1;');
    });
  });

  describe('emphasis', () => {
    it('should normalize bold markers consistently', () => {
      const result = roundTrip('This is **bold** text');
      expect(result).toBe('This is **bold** text');
    });

    it('should normalize italic markers consistently', () => {
      const result = roundTrip('This is *italic* text');
      // With emphasis: '_', remark may use underscores
      console.log('[Italic normalized]:', JSON.stringify(result));
      expect(result).toMatchSnapshot('italic-normalized');
    });
  });

  describe('idempotency', () => {
    it('should produce identical output on second pass', () => {
      const input = `# Heading

- Item 1
- Item 2
- Item 3

> A blockquote

| Col A | Col B |
| --- | --- |
| 1 | 2 |

---

**Bold** and *italic* text.`;

      const first = roundTrip(input);
      const second = normalizeMarkdown(first).trimEnd();

      expect(second).toBe(first);
    });

    it('should be idempotent on the comprehensive fixture', () => {
      const fixture = `# Heading 1

## Heading 2

Paragraph with **bold**, *italic*, and \`code\`.

---

1. First item
2. Second item
3. Third item

- Apple
- Banana
- Cherry

- [ ] Unchecked
- [x] Checked

| Name | Age | City |
| --- | --- | --- |
| Alice | 30 | NYC |
| Bob | 25 | LA |

> A blockquote line

\`\`\`typescript
function hello() {
  return 'world';
}
\`\`\`

[Link](https://example.com)

![Image](https://example.com/img.png)`;

      const first = roundTrip(fixture);
      const second = normalizeMarkdown(first).trimEnd();
      const third = normalizeMarkdown(second).trimEnd();

      expect(second).toBe(first);
      expect(third).toBe(first);
    });
  });

  describe('Claude-authored markdown survives BlockNote round-trip', () => {
    // The real scenario: Claude writes a markdown file with standard formatting,
    // user opens it in BlockNote, edits, saves. The saved file should match
    // what normalizeMarkdown would produce from the original.
    // i.e., normalizeMarkdown(blockNoteRoundTrip(original)) === normalizeMarkdown(original)

    function expectSurvivesRoundTrip(label: string, original: string) {
      const normalized = normalizeMarkdown(original).trimEnd();
      const afterBlockNote = roundTrip(original);

      const normalizedLines = normalized.split('\n');
      const resultLines = afterBlockNote.split('\n');

      const diffs: string[] = [];
      const maxLen = Math.max(normalizedLines.length, resultLines.length);
      for (let i = 0; i < maxLen; i++) {
        const norm = normalizedLines[i] ?? '<missing>';
        const out = resultLines[i] ?? '<missing>';
        if (norm !== out) {
          diffs.push(
            `Line ${i + 1}:\n  EXPECTED: ${JSON.stringify(norm)}\n  GOT:      ${JSON.stringify(out)}`,
          );
        }
      }

      if (diffs.length > 0) {
        console.log(`\n[${label}]: ${diffs.length} lines differ:\n`);
        console.log(diffs.join('\n'));
      } else {
        console.log(`\n[${label}]: PERFECT - zero differences`);
      }

      expect(afterBlockNote).toBe(normalized);
    }

    it('should preserve a typical spec document', () => {
      expectSurvivesRoundTrip(
        'Spec document',
        `# Project Plan

## Overview

This is a **spec document** with *various* markdown constructs.

---

## Tasks

1. First task
2. Second task
3. Third task

## Requirements

- Must support markdown
- Must preserve formatting
- Must be idempotent

## Status

- [ ] Draft
- [x] Reviewed
- [ ] Approved

## Data

| Feature | Priority | Status |
| --- | --- | --- |
| Editor | High | Done |
| Comments | Medium | WIP |
| Export | Low | Todo |

> Important: this section contains critical notes.

\`\`\`typescript
interface Config {
  theme: 'light' | 'dark';
  autosave: boolean;
}
\`\`\`

[Documentation](https://docs.example.com)

![Architecture](https://example.com/arch.png)

Simple paragraph at the end.
`,
      );
    });

    it('should preserve a README-style document', () => {
      expectSurvivesRoundTrip(
        'README',
        `# My Project

A brief description of the project.

## Installation

\`\`\`bash
npm install my-project
\`\`\`

## Usage

\`\`\`typescript
import { MyProject } from 'my-project';

const project = new MyProject({ debug: true });
project.run();
\`\`\`

## API

| Method | Description | Returns |
| --- | --- | --- |
| \`run()\` | Starts the project | \`void\` |
| \`stop()\` | Stops the project | \`Promise<void>\` |

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT
`,
      );
    });

    it('should preserve a task list / checklist', () => {
      expectSurvivesRoundTrip(
        'Task list',
        `# Sprint 42

## In Progress

- [x] Fix login bug
- [ ] Add dark mode support
- [ ] Update API documentation

## Backlog

- Performance optimization for dashboard
- Migrate to new auth provider
- Add unit tests for utils

## Notes

The **login bug** was caused by a race condition in the session handler.

See \`src/auth/session.ts\` for details.
`,
      );
    });

    it('should preserve mixed content with all common constructs', () => {
      expectSurvivesRoundTrip(
        'Mixed content',
        `# Architecture Decision Record

## Context

We need to choose between **Option A** and **Option B** for the new data layer.

## Decision

We chose *Option A* because:

1. Better performance under load
2. Simpler API surface
3. Existing team expertise

## Consequences

- Must migrate existing \`DataService\` calls
- Need to update the **CI pipeline**
- ~~Old adapter can be removed~~ (keep for now)

---

## Implementation

\`\`\`typescript
export class NewDataLayer {
  private cache: Map<string, unknown>;

  async query(sql: string): Promise<Row[]> {
    return this.cache.get(sql) ?? await this.execute(sql);
  }
}
\`\`\`

| Metric | Before | After |
| --- | --- | --- |
| p50 latency | 120ms | 45ms |
| p99 latency | 800ms | 200ms |
| Memory | 512MB | 256MB |

> Note: benchmarks run on staging environment with production-like data.
`,
      );
    });
  });
});
