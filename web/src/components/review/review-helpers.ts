import type { ConversationItem } from '@/server/github/pr-detail';

export type ReviewTab = 'overview' | 'files' | 'checks';

export const REVIEW_TABS: Array<{ value: ReviewTab; label: string; key: string }> = [
  { value: 'overview', label: 'Overview', key: '1' },
  { value: 'files', label: 'Files', key: '2' },
  { value: 'checks', label: 'Checks', key: '3' },
];

interface ReviewerVerdict {
  login: string;
  avatarUrl: string | null;
  state: string;
}

const VERDICT_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

export function latestReviewVerdicts(conversation: ConversationItem[]): ReviewerVerdict[] {
  const byLogin = new Map<string, ReviewerVerdict>();
  for (const item of conversation) {
    if (item.kind !== 'review' || !item.author) continue;
    const previous = byLogin.get(item.author.login);
    const keepPrevious =
      previous && VERDICT_STATES.has(previous.state) && !VERDICT_STATES.has(item.state);
    if (keepPrevious) continue;
    byLogin.set(item.author.login, {
      login: item.author.login,
      avatarUrl: item.author.avatarUrl,
      state: item.state,
    });
  }
  return [...byLogin.values()];
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Requested changes',
  COMMENTED: 'Commented',
  DISMISSED: 'Dismissed',
};

export function reviewStateLabel(state: string): string {
  return REVIEW_STATE_LABELS[state] ?? state;
}

export function isBehindGithub(
  worktreeHeadSha: string,
  githubHeadSha: string | undefined,
): boolean {
  return githubHeadSha !== undefined && githubHeadSha !== '' && githubHeadSha !== worktreeHeadSha;
}

export function isPrChangeForReview(
  payload: { workspaceId: number; repo: string },
  workspaceId: number,
  repoPath: string | null,
): boolean {
  if (payload.workspaceId !== workspaceId) return false;
  return repoPath === null || payload.repo === repoPath;
}
