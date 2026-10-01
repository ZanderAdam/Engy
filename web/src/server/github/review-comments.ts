import type { AppState } from '../trpc/context';
import { githubRestPaginated } from './client';

export interface GithubReviewComment {
  githubId: number;
  path: string;
  line: number | null;
  body: string;
  author: string;
  createdAt: string;
  inReplyToId: number | null;
  url: string;
}

interface RawReviewComment {
  id: number;
  path: string;
  line: number | null;
  original_line: number | null;
  body: string;
  user: { login: string };
  created_at: string;
  in_reply_to_id?: number;
  html_url: string;
}

export async function fetchReviewComments(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<GithubReviewComment[]> {
  const raw = await githubRestPaginated<RawReviewComment>(
    state,
    `/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`,
  );
  return raw.map((c) => ({
    githubId: c.id,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    body: c.body,
    author: c.user.login,
    createdAt: c.created_at,
    inReplyToId: c.in_reply_to_id ?? null,
    url: c.html_url,
  }));
}
