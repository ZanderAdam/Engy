import type { AppState } from '../trpc/context';
import { diffDocFilePath } from '@/lib/diff-doc-path';
import { isGithubDraft, toGithubSide } from '@/lib/github-draft';
import { githubRest } from './client';

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

interface ReviewComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
}

interface SubmitReviewInput {
  repoFullName: string;
  prNumber: number;
  commitId: string;
  event: ReviewEvent;
  body: string;
  comments: ReviewComment[];
}

interface DraftCandidate {
  documentPath: string;
  metadata: Record<string, unknown> | null;
  comments: Array<{ body: unknown; deletedAt?: string | null }>;
}

export function draftsToReviewComments(threads: DraftCandidate[]): ReviewComment[] {
  const comments: ReviewComment[] = [];
  for (const thread of threads) {
    if (!isGithubDraft(thread.metadata)) continue;
    const path = diffDocFilePath(thread.documentPath);
    const line = thread.metadata?.lineNumber;
    const body = thread.comments.find((c) => c.deletedAt == null)?.body;
    if (!path || typeof line !== 'number' || line < 1 || typeof body !== 'string') continue;
    comments.push({ path, line, side: toGithubSide(thread.metadata?.side), body });
  }
  return comments;
}

export async function submitReview(state: AppState, input: SubmitReviewInput): Promise<void> {
  await githubRest(state, `/repos/${input.repoFullName}/pulls/${input.prNumber}/reviews`, {
    method: 'POST',
    body: {
      commit_id: input.commitId,
      event: input.event,
      body: input.body,
      comments: input.comments,
    },
  });
}

export async function fetchPullHeadSha(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<string> {
  const result = await githubRest<{ head: { sha: string } }>(
    state,
    `/repos/${repoFullName}/pulls/${prNumber}`,
  );
  if (result.status !== 'ok') {
    throw new Error(`GitHub returned no data for ${repoFullName}#${prNumber}`);
  }
  return result.data.head.sha;
}
