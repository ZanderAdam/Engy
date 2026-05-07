/**
 * Bridge between BlockNote's default fenced `codeBlock` and our custom `mermaid` block.
 * Lets mermaid round-trip through markdown as ```mermaid ... ``` while still rendering
 * with a custom React component in the editor.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = { type: string; props?: any; content?: any; children?: AnyBlock[] };

function inlineToString(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((node) => {
      if (node && typeof node === 'object' && 'type' in node && (node as { type: string }).type === 'text') {
        return (node as { text?: string }).text ?? '';
      }
      return '';
    })
    .join('');
}

export function codeBlockToMermaid<T extends AnyBlock>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const next: AnyBlock = { ...block };
    if (block.children?.length) {
      next.children = codeBlockToMermaid(block.children);
    }
    if (block.type === 'codeBlock' && block.props?.language === 'mermaid') {
      const code = inlineToString(block.content);
      return {
        ...next,
        type: 'mermaid',
        props: { code },
        content: [],
      } as T;
    }
    return next as T;
  });
}

export function mermaidToCodeBlock<T extends AnyBlock>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const next: AnyBlock = { ...block };
    if (block.children?.length) {
      next.children = mermaidToCodeBlock(block.children);
    }
    if (block.type === 'mermaid') {
      const code = (block.props?.code as string | undefined) ?? '';
      return {
        ...next,
        type: 'codeBlock',
        props: { language: 'mermaid' },
        content: code === '' ? [] : [{ type: 'text', text: code, styles: {} }],
      } as T;
    }
    return next as T;
  });
}
