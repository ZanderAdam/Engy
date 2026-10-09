import type { AppState } from '../trpc/context';
import { githubGraphql } from './client';
import { sameLogin } from './timeline';

interface GithubReply {
  id: number;
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  onViewerPr: boolean;
  author: string;
  body: string;
  url: string;
  createdAt: string;
  path: string | null;
  line: number | null;
}

interface RawComment {
  databaseId: number;
  body: string;
  url: string;
  createdAt: string;
  author: { __typename: string; login: string } | null;
}

interface RawThread {
  path: string;
  line: number | null;
  originalLine: number | null;
  comments: { nodes: RawComment[] };
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  comments: { nodes: RawComment[] };
  reviewThreads: { nodes: RawThread[] };
}

interface RepliesResponse {
  search: { nodes: Array<Partial<RawPr> | null> };
}

export const MAX_REPLIES = 200;
const PR_LIMIT = 30;
const REPLIES_SEARCH = 'is:pr is:open involves:@me sort:updated-desc';

const REPLIES_QUERY = `
query Replies($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        author { login }
        repository { nameWithOwner }
        comments(last: 50) {
          nodes { databaseId body url createdAt author { __typename login } }
        }
        reviewThreads(last: 50) {
          nodes {
            path
            line
            originalLine
            comments(first: 50) {
              nodes { databaseId body url createdAt author { __typename login } }
            }
          }
        }
      }
    }
  }
}`;

function isPullRequest(node: Partial<RawPr> | null): node is RawPr {
  return node?.number !== undefined;
}

function authorOf(comment: RawComment): string {
  return comment.author?.login ?? 'ghost';
}

function repliesIn(comments: RawComment[], viewerLogin: string, onViewerPr: boolean): RawComment[] {
  const fromOthers = comments.filter(
    (comment) => comment.author?.__typename !== 'Bot' && !sameLogin(authorOf(comment), viewerLogin),
  );
  if (onViewerPr) return fromOthers;
  const viewerFirst = comments.find((comment) => sameLogin(authorOf(comment), viewerLogin));
  if (!viewerFirst) return [];
  return fromOthers.filter((comment) => comment.createdAt > viewerFirst.createdAt);
}

function collectPrReplies(pr: RawPr, viewerLogin: string): GithubReply[] {
  const onViewerPr = sameLogin(pr.author?.login, viewerLogin);
  const toReply = (comment: RawComment, thread: RawThread | null): GithubReply => ({
    id: comment.databaseId,
    repoFullName: pr.repository.nameWithOwner,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    onViewerPr,
    author: authorOf(comment),
    body: comment.body,
    url: comment.url,
    createdAt: comment.createdAt,
    path: thread?.path ?? null,
    line: thread ? (thread.line ?? thread.originalLine) : null,
  });

  return [
    ...repliesIn(pr.comments.nodes, viewerLogin, onViewerPr).map((comment) =>
      toReply(comment, null),
    ),
    ...pr.reviewThreads.nodes.flatMap((thread) =>
      repliesIn(thread.comments.nodes, viewerLogin, onViewerPr).map((comment) =>
        toReply(comment, thread),
      ),
    ),
  ];
}

export async function fetchReplies(state: AppState, viewerLogin: string): Promise<GithubReply[]> {
  const data = await githubGraphql<RepliesResponse>(state, REPLIES_QUERY, {
    q: REPLIES_SEARCH,
    first: PR_LIMIT,
  });
  return data.search.nodes
    .filter(isPullRequest)
    .flatMap((pr) => collectPrReplies(pr, viewerLogin))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_REPLIES);
}
