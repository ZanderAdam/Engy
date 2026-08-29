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

export function getCommentText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'content' in body) {
    // BlockNote-style body
    return JSON.stringify(body);
  }
  return String(body ?? '');
}

interface FileEntry {
  lineNumber: number;
  /** Rendered under the location line; already markdown. */
  body: string[];
}

/**
 * Renders the shape both feedback documents share: a heading, a comment/file
 * count, then one `###` section per file with its entries ordered by line.
 * Files with no entries never reach here, so an empty map means no feedback.
 */
function renderFeedbackDocument(heading: string, byFile: Map<string, FileEntry[]>): string {
  if (byFile.size === 0) return '';

  for (const entries of byFile.values()) {
    entries.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  const total = [...byFile.values()].reduce((sum, entries) => sum + entries.length, 0);
  const lines = [
    `## ${heading}`,
    `${total} comment${total === 1 ? '' : 's'} across ${byFile.size} file${byFile.size === 1 ? '' : 's'}`,
    '',
  ];

  for (const [filePath, entries] of byFile) {
    lines.push(`### ${filePath}`);
    lines.push('');
    for (const entry of entries) {
      lines.push(...entry.body);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export function generateDiffFeedback(threads: DiffThread[], repoDir: string): string {
  const byFile = new Map<string, FileEntry[]>();

  for (const thread of threads.filter((t) => !t.resolved)) {
    const meta = thread.metadata as Record<string, unknown> | null;
    const lineNumber = (meta?.lineNumber as number) ?? 0;
    const codeLine = (meta?.codeLine as string) ?? '';

    const commentTexts = thread.comments.map((c) => getCommentText(c.body)).filter(Boolean);
    if (commentTexts.length === 0) continue;

    const body: string[] = [];
    if (lineNumber > 0) body.push(`**Line ${lineNumber}**`);
    // The reviewed line itself, so the agent reads the comment against what the
    // reviewer was looking at rather than re-deriving it from a line number.
    if (codeLine) body.push('```', codeLine, '```');
    body.push(commentTexts.join('\n'));

    const filePath = extractFilePath(thread.documentPath, repoDir);
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath)!.push({ lineNumber, body });
  }

  return renderFeedbackDocument('Code Review Feedback', byFile);
}

/**
 * Generates markdown feedback from selected GitHub review threads.
 * Includes author attribution, file:line context, body, and reply context.
 */
export function generateGithubFeedback(threads: GithubDiffThread[], repoDir: string): string {
  const byFile = new Map<string, FileEntry[]>();

  for (const thread of threads) {
    const author = thread.githubAuthor ?? 'GitHub';
    const lineNumber = thread.lineNumber ?? 0;

    const commentLines = thread.comments
      .map((c) => {
        const body = getCommentText(c.body);
        if (!body) return '';
        const label = c.userId ?? author;
        return `**${label}**:\n> ${body.replace(/\n/g, '\n> ')}`;
      })
      .filter(Boolean);
    if (commentLines.length === 0) continue;

    const location: string[] = [];
    if (lineNumber > 0) location.push(`**Line ${lineNumber}**`);
    if (thread.githubUrl) location.push(`[view on GitHub](${thread.githubUrl})`);

    const body: string[] = [];
    if (location.length > 0) body.push(location.join(' — '));
    body.push(commentLines.join('\n'));

    const filePath = extractFilePath(thread.documentPath, repoDir);
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath)!.push({ lineNumber, body });
  }

  return renderFeedbackDocument('GitHub Review Feedback', byFile);
}
