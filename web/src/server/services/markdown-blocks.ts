import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  depth?: number;
  ordered?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  url?: string;
  alt?: string | null;
}

type Styles = Record<string, true>;
type StyledText = { type: 'text'; text: string; styles: Styles };
type InlineContent = StyledText | { type: 'link'; href: string; content: StyledText[] };

interface Block {
  type: string;
  props?: Record<string, unknown>;
  content: InlineContent[];
  children?: Block[];
}

const INLINE_STYLES: Record<string, string> = {
  strong: 'bold',
  emphasis: 'italic',
  delete: 'strike',
};

const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'tableCell']);

const parser = unified().use(remarkParse).use(remarkGfm);

function styledText(text: string, styles: Styles): StyledText[] {
  return text ? [{ type: 'text', text, styles }] : [];
}

function toInline(nodes: MdNode[] = [], styles: Styles = {}): InlineContent[] {
  return nodes.flatMap((node): InlineContent[] => {
    const style = INLINE_STYLES[node.type];
    if (style) return toInline(node.children, { ...styles, [style]: true });

    switch (node.type) {
      case 'text':
        return styledText(node.value ?? '', styles);
      case 'break':
        return styledText('\n', styles);
      case 'inlineCode':
        return styledText(node.value ?? '', { ...styles, code: true });
      case 'image':
        return [
          {
            type: 'link',
            href: node.url ?? '',
            content: styledText(node.alt || node.url || '', styles),
          },
        ];
      case 'link':
        return [
          {
            type: 'link',
            href: node.url ?? '',
            content: toInline(node.children, styles).filter(
              (item): item is StyledText => item.type === 'text',
            ),
          },
        ];
      default:
        return node.children
          ? toInline(node.children, styles)
          : styledText(node.value ?? '', styles);
    }
  });
}

function flattenBlock(node: MdNode): InlineContent[] {
  if (!node.children) return styledText(node.value ?? '', {});
  if (PHRASING_PARENTS.has(node.type)) return toInline(node.children);
  const separator = node.type === 'tableRow' ? ' | ' : '\n';
  return node.children.flatMap((child, index) => [
    ...(index > 0 ? styledText(separator, {}) : []),
    ...flattenBlock(child),
  ]);
}

function listItemType(list: MdNode, item: MdNode): string {
  if (typeof item.checked === 'boolean') return 'checkListItem';
  return list.ordered ? 'numberedListItem' : 'bulletListItem';
}

function toListItem(list: MdNode, item: MdNode): Block {
  const [first, ...rest] = item.children ?? [];
  const startsWithParagraph = first?.type === 'paragraph';
  const type = listItemType(list, item);
  const block: Block = {
    type,
    content: startsWithParagraph ? toInline(first.children) : [],
    children: toBlocks(startsWithParagraph ? rest : (item.children ?? [])),
  };
  if (type === 'checkListItem') block.props = { checked: item.checked };
  return block;
}

function toBlocks(nodes: MdNode[]): Block[] {
  return nodes.flatMap((node): Block[] => {
    switch (node.type) {
      case 'paragraph':
        return [{ type: 'paragraph', content: toInline(node.children) }];
      case 'heading':
        return [
          {
            type: 'heading',
            props: { level: node.depth ?? 1 },
            content: toInline(node.children),
          },
        ];
      case 'code':
        return [
          {
            type: 'codeBlock',
            props: node.lang ? { language: node.lang } : {},
            content: styledText(node.value ?? '', {}),
          },
        ];
      case 'blockquote':
        return [{ type: 'quote', content: flattenBlock(node) }];
      case 'list':
        return (node.children ?? []).map((item) => toListItem(node, item));
      case 'thematicBreak':
        return [];
      default:
        return [{ type: 'paragraph', content: flattenBlock(node) }];
    }
  });
}

export function markdownToBlocks(markdown: string): Block[] {
  const blocks = toBlocks((parser.parse(markdown) as MdNode).children ?? []);
  if (blocks.length > 0) return blocks;
  return [{ type: 'paragraph', content: styledText(markdown.trim(), {}) }];
}
