import type { GhPrCheck, GhPrCiStatus } from '@engy/common';
import type { AppState } from '../trpc/context';
import { deriveCheckState } from '../../lib/pr-check-state';
import { githubGraphql } from './client';
import { resolveRepoFullName } from './repo-identity';

export interface GithubPr {
  repoFullName: string;
  number: number;
  title: string;
  url: string;
  headBranch: string;
  headSha: string | null;
  baseBranch: string;
  author: string;
  isDraft: boolean;
  reviewDecision: string | null;
  ciStatus: GhPrCiStatus;
  checks: GhPrCheck[];
  /** Conversation comments plus review submissions that carry a body. */
  commentCount: number;
  authoredByViewer: boolean;
  additions: number;
  deletions: number;
  /** User logins and `org/team` slugs with a pending review request. */
  reviewRequests: string[];
  updatedAt: string;
  hasConflicts: boolean;
  isCrossRepository: boolean;
}

interface RawCheckRun {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  completedAt?: string | null;
}

interface RawStatusContext {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt?: string | null;
}

export type RawStatusCheckEntry = RawCheckRun | RawStatusContext;

export interface RawReviewer {
  __typename: string;
  login?: string;
  slug?: string;
  organization?: { login: string };
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string | null;
  baseRefName: string;
  author: { login: string } | null;
  isDraft: boolean;
  state: string;
  mergeable: string;
  isCrossRepository: boolean;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  updatedAt: string;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  reviews: { nodes: Array<{ body: string }> };
  reviewRequests: { nodes: Array<{ requestedReviewer: RawReviewer | null }> };
  commits: {
    nodes: Array<{
      commit: { statusCheckRollup: { contexts: { nodes: RawStatusCheckEntry[] } } | null };
    }>;
  };
}

interface SearchResponse {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<RawPr | null>;
  };
}

const PAGE_SIZE = 50;
const MAX_PRS_PER_QUERY = 100;
const MAX_PAGES = MAX_PRS_PER_QUERY / PAGE_SIZE;

const SEARCH_QUERY = `
query OpenPrs($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        url
        headRefName
        headRefOid
        baseRefName
        author { login }
        isDraft
        state
        mergeable
        isCrossRepository
        reviewDecision
        additions
        deletions
        updatedAt
        repository { nameWithOwner }
        comments { totalCount }
        reviews(first: 100) { nodes { body } }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Team { slug organization { login } }
            }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl completedAt }
                    ... on StatusContext { context state targetUrl createdAt }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const PR_STATE_QUERY = `
query PrState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state }
  }
}`;

interface PrStateResponse {
  repository: { pullRequest: { state: string } | null } | null;
}

const AUTHORED_SEARCH = 'is:pr is:open author:@me';
const REVIEW_REQUESTED_SEARCH = 'is:pr is:open review-requested:@me';

export function deriveCiStatus(rollup: RawStatusCheckEntry[] | null): GhPrCiStatus {
  if (!rollup || rollup.length === 0) return 'unknown';

  const states = rollup.map((entry) => {
    const { status, conclusion } = normalizeCheck(entry);
    return deriveCheckState(status, conclusion);
  });
  if (states.includes('failing')) return 'failing';
  return states.includes('pending') ? 'pending' : 'passing';
}

export function normalizeCheck(entry: RawStatusCheckEntry): GhPrCheck {
  if (entry.__typename === 'CheckRun') {
    return {
      name: entry.name,
      status: entry.status,
      conclusion: entry.conclusion ?? null,
      detailsUrl: entry.detailsUrl ?? null,
      completedAt: entry.completedAt ?? null,
    };
  }
  return {
    name: entry.context,
    status: entry.state,
    conclusion: null,
    detailsUrl: entry.targetUrl ?? null,
    completedAt: entry.createdAt ?? null,
  };
}

function countComments(pr: RawPr): number {
  const bodiedReviews = pr.reviews.nodes.filter((r) => r.body.trim().length > 0).length;
  return pr.comments.totalCount + bodiedReviews;
}

export function reviewerName(reviewer: RawReviewer | null): string | null {
  if (!reviewer) return null;
  if (reviewer.__typename === 'Team' && reviewer.slug) {
    return reviewer.organization
      ? `${reviewer.organization.login}/${reviewer.slug}`
      : reviewer.slug;
  }
  return reviewer.login ?? null;
}

function toGithubPr(raw: RawPr, authoredByViewer: boolean): GithubPr {
  const rollup = raw.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? null;
  return {
    repoFullName: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    headBranch: raw.headRefName,
    headSha: raw.headRefOid ?? null,
    baseBranch: raw.baseRefName,
    author: raw.author?.login ?? 'ghost',
    isDraft: raw.isDraft,
    reviewDecision: raw.reviewDecision ?? null,
    ciStatus: deriveCiStatus(rollup),
    checks: (rollup ?? []).map(normalizeCheck),
    commentCount: countComments(raw),
    authoredByViewer,
    additions: raw.additions,
    deletions: raw.deletions,
    reviewRequests: raw.reviewRequests.nodes
      .map((node) => reviewerName(node.requestedReviewer))
      .filter((name): name is string => name !== null),
    updatedAt: raw.updatedAt,
    hasConflicts: raw.mergeable === 'CONFLICTING',
    isCrossRepository: raw.isCrossRepository,
  };
}

async function searchOpenPrs(state: AppState, search: string): Promise<RawPr[]> {
  const prs: RawPr[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: SearchResponse = await githubGraphql<SearchResponse>(state, SEARCH_QUERY, {
      q: search,
      first: PAGE_SIZE,
      after,
    });
    prs.push(...data.search.nodes.filter((node): node is RawPr => node?.state === 'OPEN'));
    if (!data.search.pageInfo.hasNextPage) break;
    after = data.search.pageInfo.endCursor;
  }
  return prs;
}

function prKey(pr: RawPr): string {
  return `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`;
}

export async function listOpenPrs(state: AppState): Promise<GithubPr[]> {
  const [authored, reviewRequested] = await Promise.all([
    searchOpenPrs(state, AUTHORED_SEARCH),
    searchOpenPrs(state, REVIEW_REQUESTED_SEARCH),
  ]);
  const authoredKeys = new Set(authored.map(prKey));
  const reviewOnly = reviewRequested.filter((pr) => !authoredKeys.has(prKey(pr)));
  return [
    ...authored.map((pr) => toGithubPr(pr, true)),
    ...reviewOnly.map((pr) => toGithubPr(pr, false)),
  ];
}

export async function resolveRepoPrs(
  state: AppState,
  repoPath: string,
  openPrs: GithubPr[],
): Promise<GithubPr[]> {
  const fullName = await resolveRepoFullName(state, repoPath);
  if (fullName === null) {
    throw new Error(`No GitHub remote found for ${repoPath}`);
  }
  const wanted = fullName.toLowerCase();
  return openPrs.filter((pr) => pr.repoFullName.toLowerCase() === wanted);
}

export async function fetchPrState(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<string | null> {
  const [owner, name] = repoFullName.split('/');
  const data = await githubGraphql<PrStateResponse>(state, PR_STATE_QUERY, {
    owner,
    name,
    number: prNumber,
  });
  return data.repository?.pullRequest?.state ?? null;
}
