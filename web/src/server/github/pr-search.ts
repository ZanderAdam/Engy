import type { AppState } from '../trpc/context';
import { parsePrReference } from '../../lib/pr-reference';
import { toInboxPrState, type InboxPrState } from '../inbox/store';
import { githubGraphql } from './client';
import { GithubError, type GithubErrorKind } from './errors';

interface FoundPr {
  repoFullName: string;
  prNumber: number;
  title: string;
  url: string;
  state: InboxPrState;
  isDraft: boolean;
  author: string;
  updatedAt: string;
}

interface PrSearchPage {
  prs: FoundPr[];
  hasMore: boolean;
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  updatedAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
}

interface SearchResponse {
  search: { issueCount: number; nodes: Array<Partial<RawPr> | null> };
}

interface LookupResponse {
  repository: { pullRequest: RawPr | null } | null;
}

export const PR_SEARCH_LIMIT = 50;
const SKIPPED_LOOKUP_ERRORS: ReadonlySet<GithubErrorKind> = new Set(['not_found', 'forbidden']);
const STATE_QUALIFIER = /(^|\s)-?(is:(open|closed|merged|unmerged)|state:)/i;
const SORT_QUALIFIER = /(^|\s)sort:/i;

const PR_FIELDS = `
fragment FoundPr on PullRequest {
  number
  title
  url
  state
  isDraft
  updatedAt
  author { login }
  repository { nameWithOwner }
}`;

const SEARCH_QUERY = `
query PrSearch($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    issueCount
    nodes { ...FoundPr }
  }
}
${PR_FIELDS}`;

const LOOKUP_QUERY = `
query PrLookup($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ...FoundPr }
  }
}
${PR_FIELDS}`;

function isPullRequest(node: Partial<RawPr> | null): node is RawPr {
  return node?.number !== undefined;
}

function toFoundPr(pr: RawPr): FoundPr {
  return {
    repoFullName: pr.repository.nameWithOwner,
    prNumber: pr.number,
    title: pr.title,
    url: pr.url,
    state: toInboxPrState(pr.state),
    isDraft: pr.isDraft,
    author: pr.author?.login ?? 'ghost',
    updatedAt: pr.updatedAt,
  };
}

export function buildPrSearchQuery(repos: string[], query: string): string {
  const trimmed = query.trim();
  const parts = ['is:pr', ...repos.map((repo) => `repo:${repo}`)];
  if (!STATE_QUALIFIER.test(trimmed)) parts.push('is:open');
  if (!SORT_QUALIFIER.test(trimmed)) parts.push('sort:updated-desc');
  if (trimmed) parts.push(trimmed);
  return parts.join(' ');
}

async function lookupPr(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<FoundPr | null> {
  const [owner, name] = repoFullName.split('/');
  try {
    const data = await githubGraphql<LookupResponse>(state, LOOKUP_QUERY, {
      owner,
      name,
      number: prNumber,
    });
    const pr = data.repository?.pullRequest;
    return pr ? toFoundPr(pr) : null;
  } catch (error) {
    if (error instanceof GithubError && SKIPPED_LOOKUP_ERRORS.has(error.kind)) return null;
    throw error;
  }
}

export async function searchPrs(
  state: AppState,
  repos: string[],
  query: string,
): Promise<PrSearchPage> {
  const inScope = new Set(repos.map((repo) => repo.toLowerCase()));
  if (inScope.size === 0) return { prs: [], hasMore: false };

  const reference = parsePrReference(query);
  if (reference) {
    const targets = reference.repoFullName ? [reference.repoFullName] : repos;
    const found = await Promise.all(
      targets
        .filter((repo) => inScope.has(repo.toLowerCase()))
        .map((repo) => lookupPr(state, repo, reference.prNumber)),
    );
    return { prs: found.filter((pr) => pr !== null), hasMore: false };
  }

  const data = await githubGraphql<SearchResponse>(state, SEARCH_QUERY, {
    q: buildPrSearchQuery(repos, query),
    first: PR_SEARCH_LIMIT,
  });
  const prs = data.search.nodes
    .filter(isPullRequest)
    .filter((pr) => inScope.has(pr.repository.nameWithOwner.toLowerCase()))
    .map(toFoundPr);
  return { prs, hasMore: data.search.issueCount > PR_SEARCH_LIMIT };
}
