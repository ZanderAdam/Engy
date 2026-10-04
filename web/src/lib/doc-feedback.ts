import {
  REPLY_HINT,
  renderThreadComments,
  threadIdLine,
  type FeedbackComment,
} from '@/lib/comment-feedback';

interface DocThread {
  resolved: boolean;
  deletedAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
  comments: Array<FeedbackComment & { deletedAt?: Date | string | null }>;
}

interface FormatCommentsOptions {
  threads: Map<string, DocThread>;
  /** Current document text; without it a thread shows its quote but no line number. */
  markdown?: string;
  filePath?: string;
}

export function formatCommentsForExport({
  threads,
  markdown,
  filePath,
}: FormatCommentsOptions): string {
  const lines: string[] = [];

  for (const [threadId, thread] of threads) {
    if (thread.deletedAt || thread.resolved) continue;
    const quoted = renderThreadComments(thread.comments.filter((c) => !c.deletedAt));
    if (quoted.length === 0) continue;

    const anchor = thread.metadata?.anchor as { exact?: string } | undefined;
    const exact = anchor?.exact;
    const lineNum = exact && markdown ? findLineNumber(markdown, exact) : null;
    if (exact && lineNum) {
      lines.push(`Line ${lineNum}: "${exact}"`);
    } else if (exact) {
      lines.push(`"${exact}"`);
    }

    lines.push(threadIdLine(threadId));
    lines.push(...quoted);
    lines.push('');
  }

  if (lines.length === 0) return '';
  const header = filePath ? [`# Comments on ${filePath}`, REPLY_HINT, ''] : [];
  return [...header, ...lines].join('\n').trim();
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
