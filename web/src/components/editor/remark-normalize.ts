import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin that forces all lists to be "tight" (no blank lines between items).
 * BlockNote exports all lists as "spread" (loose) which adds blank lines.
 */
function compactLists() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    visit(tree, 'list', (node) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = node as any;
      list.spread = false;
      for (const child of list.children) {
        child.spread = false;
      }
    });
  };
}

/**
 * Remark plugin that replaces hard breaks (`\` at end of line) with spaces.
 * BlockNote adds these spuriously in paragraphs and blockquotes, and they
 * grow on each save cycle inside blockquotes.
 */
function stripHardBreaks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'paragraph', (para: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      para.children = para.children.map((child: any) =>
        child.type === 'break' ? { type: 'text', value: ' ' } : child,
      );
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(compactLists)
  .use(stripHardBreaks)
  .use(remarkStringify, {
    bullet: '-',
    rule: '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    listItemIndent: 'one',
  });

/**
 * Normalize markdown output from BlockNote into a consistent, idempotent format.
 *
 * BlockNote's `blocksToMarkdownLossy` produces inconsistent formatting:
 * - Loose lists (blank lines between items)
 * - `*` for all bullets/HRs
 * - Non-idempotent blockquotes (grow `> \` lines each save cycle)
 *
 * This function re-parses and re-serializes through remark with fixed settings,
 * producing consistent output regardless of what BlockNote does.
 */
export function normalizeMarkdown(markdown: string): string {
  const result = processor.processSync(markdown);
  return String(result);
}
