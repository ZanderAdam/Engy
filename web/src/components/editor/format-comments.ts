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

function extractCommentText(body: unknown): string {
  if (!body || !Array.isArray(body)) return '';
  return body
    .map((block: { content?: Array<{ type: string; text?: string }> }) => {
      if (!block.content || !Array.isArray(block.content)) return '';
      return block.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('');
    })
    .join('\n')
    .trim();
}
