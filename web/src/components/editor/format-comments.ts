import { REPLY_HINT, threadIdLine } from '@/lib/comment-feedback';

interface ThreadLike {
  resolved: boolean;
  deletedAt?: Date | null;
  metadata?: Record<string, unknown>;
  comments: Array<{
    deletedAt?: Date | null;
    body: unknown;
  }>;
}

interface FormatCommentsOptions {
  threads: Map<string, ThreadLike>;
  markdown: string;
  filePath?: string;
}

export function formatCommentsForExport({
  threads,
  markdown,
  filePath,
}: FormatCommentsOptions): string {
  const lines: string[] = [];

  if (filePath) {
    lines.push(`# Comments on ${filePath}`);
    lines.push(REPLY_HINT);
    lines.push('');
  }

  for (const [threadId, thread] of threads) {
    if (thread.deletedAt || thread.resolved) continue;
    const threadComments = thread.comments.filter((c) => !c.deletedAt);
    if (threadComments.length === 0) continue;

    const anchor = thread.metadata?.anchor as
      | { exact?: string }
      | undefined;
    const exact = anchor?.exact;
    const lineNum = exact ? findLineNumber(markdown, exact) : null;
    if (exact && lineNum) {
      lines.push(`Line ${lineNum}: "${exact}"`);
    } else if (exact) {
      lines.push(`"${exact}"`);
    }

    lines.push(threadIdLine(threadId));
    for (const comment of threadComments) {
      lines.push(`> ${extractCommentText(comment.body)}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function findLineNumber(markdown: string, exact: string): number | null {
  const mdLines = markdown.split('\n');
  for (let i = 0; i < mdLines.length; i++) {
    if (mdLines[i].includes(exact)) return i + 1;
  }
  const firstChunk = exact.split('\n')[0].trim();
  if (firstChunk && firstChunk !== exact) {
    for (let i = 0; i < mdLines.length; i++) {
      if (mdLines[i].includes(firstChunk)) return i + 1;
    }
  }
  return null;
}

interface InlineItem {
  type: string;
  text?: string;
  content?: InlineItem[];
}

interface CommentBlock {
  type: string;
  props?: { checked?: boolean };
  content?: InlineItem[];
  children?: CommentBlock[];
}

function inlineText(content: InlineItem[] = []): string {
  return content
    .map((item) => (item.type === 'link' ? inlineText(item.content) : (item.text ?? '')))
    .join('');
}

function blockPrefix(block: CommentBlock): string {
  switch (block.type) {
    case 'bulletListItem':
      return '- ';
    case 'numberedListItem':
      return '1. ';
    case 'checkListItem':
      return block.props?.checked ? '- [x] ' : '- [ ] ';
    default:
      return '';
  }
}

function blockLines(block: CommentBlock, depth: number): string[] {
  const text = Array.isArray(block.content) ? inlineText(block.content) : '';
  const line = '  '.repeat(depth) + blockPrefix(block) + text;
  return [line, ...(block.children ?? []).flatMap((child) => blockLines(child, depth + 1))];
}

function extractCommentText(body: unknown): string {
  if (!body || !Array.isArray(body)) return '';
  return (body as CommentBlock[])
    .flatMap((block) => blockLines(block, 0))
    .join('\n')
    .trim();
}
