interface DiffThread {
  documentPath: string;
  metadata?: Record<string, unknown> | null;
  resolved?: boolean;
  comments: Array<{
    body: unknown;
    userId?: string;
    createdAt?: string;
  }>;
}

export interface GithubDiffThread {
  documentPath: string;
  lineNumber?: number;
  githubAuthor?: string;
  githubUrl?: string;
  comments: Array<{
    body: unknown;
    userId?: string | null;
    createdAt?: string | null;
  }>;
}

function extractFilePath(documentPath: string, repoDir: string): string {
  // documentPath format: diff://{repoDir}/{filePath}
  const prefix = `diff://${repoDir}/`;
  if (documentPath.startsWith(prefix)) {
    return documentPath.slice(prefix.length);
  }
  // Fallback: strip diff:// prefix
  return documentPath.replace(/^diff:\/\//, '');
}

function getCommentText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'content' in body) {
    // BlockNote-style body
    return JSON.stringify(body);
  }
  return String(body ?? '');
}

export function generateDiffFeedback(threads: DiffThread[], repoDir: string): string {
  const unresolvedThreads = threads.filter((t) => !t.resolved);
  if (unresolvedThreads.length === 0) return '';

  // Group by file
  const byFile = new Map<string, Array<{ lineNumber: number; codeLine: string; text: string }>>();

  for (const thread of unresolvedThreads) {
    const filePath = extractFilePath(thread.documentPath, repoDir);
    const meta = thread.metadata as Record<string, unknown> | null;
    const lineNumber = (meta?.lineNumber as number) ?? 0;
    const codeLine = (meta?.codeLine as string) ?? '';

    const commentTexts = thread.comments
      .map((c) => getCommentText(c.body))
      .filter(Boolean);

    if (commentTexts.length === 0) continue;

    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath)!.push({
      lineNumber,
      codeLine,
      text: commentTexts.join('\n'),
    });
  }

  if (byFile.size === 0) return '';

  // Sort entries within each file by line number
  for (const entries of byFile.values()) {
    entries.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  const totalComments = [...byFile.values()].reduce((sum, entries) => sum + entries.length, 0);
  const lines: string[] = [];

  lines.push(`## Code Review Feedback`);
  lines.push(`${totalComments} comment${totalComments === 1 ? '' : 's'} across ${byFile.size} file${byFile.size === 1 ? '' : 's'}`);
  lines.push('');

  for (const [filePath, entries] of byFile) {
    lines.push(`### ${filePath}`);
    lines.push('');
    for (const entry of entries) {
      if (entry.lineNumber > 0) {
        lines.push(`**Line ${entry.lineNumber}**`);
      }
      if (entry.codeLine) {
        lines.push('```');
        lines.push(entry.codeLine);
        lines.push('```');
      }
      lines.push(entry.text);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Generates markdown feedback from selected GitHub review threads.
 * Includes author attribution, file:line context, body, and reply context.
 */
export function generateGithubFeedback(threads: GithubDiffThread[], repoDir: string): string {
  if (threads.length === 0) return '';

  const byFile = new Map<
    string,
    Array<{ lineNumber: number; author: string; url?: string; text: string }>
  >();

  for (const thread of threads) {
    const filePath = extractFilePath(thread.documentPath, repoDir);
    const lineNumber = thread.lineNumber ?? 0;
    const author = thread.githubAuthor ?? 'GitHub';
    const url = thread.githubUrl;

    const commentLines = thread.comments
      .map((c) => {
        const body = getCommentText(c.body);
        if (!body) return '';
        const label = c.userId ?? author;
        return `**${label}**: ${body}`;
      })
      .filter(Boolean);

    if (commentLines.length === 0) continue;

    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath)!.push({ lineNumber, author, url, text: commentLines.join('\n') });
  }

  if (byFile.size === 0) return '';

  for (const entries of byFile.values()) {
    entries.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  const totalComments = [...byFile.values()].reduce((sum, entries) => sum + entries.length, 0);
  const lines: string[] = [];

  lines.push('## GitHub Review Feedback');
  lines.push(
    `${totalComments} comment${totalComments === 1 ? '' : 's'} across ${byFile.size} file${byFile.size === 1 ? '' : 's'}`,
  );
  lines.push('');

  for (const [filePath, entries] of byFile) {
    lines.push(`### ${filePath}`);
    lines.push('');
    for (const entry of entries) {
      const locationParts: string[] = [];
      if (entry.lineNumber > 0) locationParts.push(`**Line ${entry.lineNumber}**`);
      if (entry.url) locationParts.push(`[view on GitHub](${entry.url})`);
      if (locationParts.length > 0) lines.push(locationParts.join(' — '));
      lines.push(entry.text);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}
