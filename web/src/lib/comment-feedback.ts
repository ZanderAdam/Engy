export const LOCAL_USER_ID = 'local-user';
export const AGENT_USER_ID = 'agent';

export const REPLY_HINT =
  'Reply in a thread with the `replyToComment` MCP tool, passing its `thread:` id.';

export function threadIdLine(threadId: string): string {
  return `\`thread: ${threadId}\``;
}

export interface FeedbackComment {
  userId?: string | null;
  body: unknown;
  /** Already sent earlier; rendered only to show which thread a new reply belongs to. */
  context?: boolean;
}

interface PendingCandidate {
  userId?: string | null;
  sentAt?: string | null;
  deletedAt?: unknown;
}

/**
 * A comment still owed to the agent. Agent replies are excluded because the
 * agent wrote them; an agent-authored thread root (a review finding) is kept so
 * findings can still be forwarded to the agent that fixes them.
 */
export function isPendingComment(comment: PendingCandidate, isThreadRoot: boolean): boolean {
  if (comment.deletedAt || comment.sentAt) return false;
  return isThreadRoot || comment.userId !== AGENT_USER_ID;
}

function authorLabel(userId: string | null | undefined): string {
  if (!userId || userId === LOCAL_USER_ID) return 'user';
  return userId;
}

/** Plain text of a comment body: a string (diff threads) or BlockNote blocks (doc threads). */
export function commentText(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (!Array.isArray(body)) return '';
  return body
    .map((block: { content?: Array<{ type: string; text?: string }> }) => {
      if (!Array.isArray(block.content)) return '';
      return block.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('');
    })
    .join('\n')
    .trim();
}

function quoteComment(comment: FeedbackComment): string | null {
  const text = commentText(comment.body);
  if (!text) return null;
  return `> **${authorLabel(comment.userId)}:** ${text.replace(/\n/g, '\n> ')}`;
}

export function renderThreadComments(comments: FeedbackComment[]): string[] {
  const earlier = comments
    .filter((c) => c.context)
    .map(quoteComment)
    .filter((l) => l !== null);
  const fresh = comments
    .filter((c) => !c.context)
    .map(quoteComment)
    .filter((l) => l !== null);
  if (fresh.length === 0) return [];
  if (earlier.length === 0) return fresh;
  return ['Earlier in this thread (already sent):', ...earlier, 'New:', ...fresh];
}

/**
 * The set of threads a send or a live target covers: one document, or (with
 * `prefix`) every thread under a path prefix, such as a diff's branch scope.
 */
export interface CommentScopeInput {
  workspaceSlug?: string;
  documentPath: string;
  prefix?: boolean;
}

export function commentScopeKey(scope: CommentScopeInput): string {
  const match = scope.prefix ? 'prefix' : 'exact';
  return `${scope.workspaceSlug ?? ''}|${match}|${scope.documentPath}`;
}
