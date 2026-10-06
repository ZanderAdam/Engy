import type { GithubPr } from './prs';
import type { StubReply, StubRequest } from './stub-server';

export interface RawPrFixture {
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
  reviewRequests: { nodes: Array<{ requestedReviewer: Record<string, unknown> | null }> };
  commits: { nodes: Array<{ commit: { statusCheckRollup: unknown } }> };
}

export function rawPr(overrides: Partial<RawPrFixture> = {}): RawPrFixture {
  return {
    number: 1,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/1',
    headRefName: 'feat/one',
    headRefOid: 'abc123',
    baseRefName: 'main',
    author: { login: 'alice' },
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    isCrossRepository: false,
    reviewDecision: null,
    additions: 3,
    deletions: 1,
    updatedAt: '2024-01-01T00:00:00Z',
    repository: { nameWithOwner: 'org/repo' },
    comments: { totalCount: 0 },
    reviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...overrides,
  };
}

export function searchReply(
  nodes: RawPrFixture[],
  page: { hasNextPage?: boolean; endCursor?: string | null } = {},
): StubReply {
  return {
    body: {
      data: {
        search: {
          pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null },
          nodes,
        },
      },
    },
  };
}

export function searchQuery(request: StubRequest): string {
  return (JSON.parse(request.body) as { variables: { q: string } }).variables.q;
}

export function makePr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    repoFullName: 'org/repo',
    number: 1,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/1',
    headBranch: 'feat/my-feature',
    headSha: null,
    baseBranch: 'main',
    author: 'alice',
    isDraft: false,
    reviewDecision: null,
    ciStatus: 'passing',
    checks: [],
    commentCount: 0,
    authoredByViewer: false,
    additions: 0,
    deletions: 0,
    reviewRequests: [],
    updatedAt: '2024-01-01T00:00:00Z',
    hasConflicts: false,
    isCrossRepository: false,
    ...overrides,
  };
}
