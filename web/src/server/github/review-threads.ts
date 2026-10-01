import type { AppState } from '../trpc/context';
import { githubGraphql } from './client';

export interface GithubReviewThreadComment {
  githubId: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  replyToId: number | null;
}

export interface GithubReviewThread {
  nodeId: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  comments: GithubReviewThreadComment[];
}

interface RawComment {
  id: string;
  databaseId: number;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  replyTo: { databaseId: number } | null;
}

interface RawThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  startLine: number | null;
  comments: { nodes: RawComment[] };
}

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawThread[];
      };
    } | null;
  } | null;
}

const MAX_PAGES = 10;

const REVIEW_THREADS_QUERY = `
query ReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          startLine
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              author { login }
              createdAt
              updatedAt
              url
              replyTo { databaseId }
            }
          }
        }
      }
    }
  }
}`;

function toThread(raw: RawThread): GithubReviewThread {
  return {
    nodeId: raw.id,
    isResolved: raw.isResolved,
    isOutdated: raw.isOutdated,
    path: raw.path,
    line: raw.line,
    originalLine: raw.originalLine,
    startLine: raw.startLine,
    diffSide: raw.diffSide,
    comments: raw.comments.nodes.map((c) => ({
      githubId: c.databaseId,
      body: c.body,
      author: c.author?.login ?? 'ghost',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      url: c.url,
      replyToId: c.replyTo?.databaseId ?? null,
    })),
  };
}

export async function fetchReviewThreads(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<GithubReviewThread[]> {
  const [owner, name] = repoFullName.split('/');
  const threads: GithubReviewThread[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: ReviewThreadsResponse = await githubGraphql<ReviewThreadsResponse>(
      state,
      REVIEW_THREADS_QUERY,
      { owner, name, number: prNumber, after },
    );
    const connection = data.repository?.pullRequest?.reviewThreads;
    if (!connection) break;
    threads.push(...connection.nodes.map(toThread));
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return threads;
}
