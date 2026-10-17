import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { PR_SEARCH_LIMIT, buildPrSearchQuery, searchPrs } from './pr-search';
import { startStubGithub, type StubGithub, type StubReply } from './stub-server';

function rawPr(repo: string, number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-03-01T10:00:00Z',
    author: { login: 'alice' },
    repository: { nameWithOwner: repo },
    ...overrides,
  };
}

const NOT_FOUND: StubReply = {
  body: {
    data: { repository: { pullRequest: null } },
    errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a PullRequest' }],
  },
};

interface GraphqlBody {
  query: string;
  variables: { q?: string; first?: number; owner?: string; name?: string; number?: number };
}

describe('github pr search', () => {
  let stub: StubGithub;
  let state: AppState;

  function bodies(): GraphqlBody[] {
    return stub.requests.map((req) => JSON.parse(req.body) as GraphqlBody);
  }

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  describe('buildPrSearchQuery', () => {
    it('[FR-INBOX-660] should search open PRs of the given repos, newest update first, by default', () => {
      expect(buildPrSearchQuery(['acme/api', 'acme/web'], '  ')).toBe(
        'is:pr repo:acme/api repo:acme/web is:open sort:updated-desc',
      );
    });

    it('[FR-INBOX-660] should append the user query to the repo scope', () => {
      expect(buildPrSearchQuery(['acme/api'], 'author:bob flaky test')).toBe(
        'is:pr repo:acme/api is:open sort:updated-desc author:bob flaky test',
      );
    });

    it('[FR-INBOX-660] should keep the state and sort the user query names', () => {
      expect(buildPrSearchQuery(['acme/api'], 'is:merged sort:created-asc')).toBe(
        'is:pr repo:acme/api is:merged sort:created-asc',
      );
      expect(buildPrSearchQuery(['acme/api'], 'state:closed')).toBe(
        'is:pr repo:acme/api sort:updated-desc state:closed',
      );
    });
  });

  describe('searchPrs', () => {
    it('[FR-INBOX-660] should send one GraphQL search capped at the result limit', async () => {
      stub.reply(() => ({
        body: { data: { search: { issueCount: 120, nodes: [rawPr('acme/api', 1)] } } },
      }));

      const page = await searchPrs(state, ['acme/api'], 'author:alice');

      expect(bodies()).toHaveLength(1);
      expect(bodies()[0].variables).toEqual({
        q: 'is:pr repo:acme/api is:open sort:updated-desc author:alice',
        first: PR_SEARCH_LIMIT,
      });
      expect(page).toEqual({
        hasMore: true,
        prs: [
          {
            repoFullName: 'acme/api',
            prNumber: 1,
            title: 'PR 1',
            url: 'https://github.com/acme/api/pull/1',
            state: 'open',
            isDraft: false,
            author: 'alice',
            updatedAt: '2026-03-01T10:00:00Z',
          },
        ],
      });
    });

    it('[FR-INBOX-660] should drop results from repos outside the given repos', async () => {
      stub.reply(() => ({
        body: {
          data: {
            search: {
              issueCount: 3,
              nodes: [rawPr('Acme/Api', 1), rawPr('evil/other', 2), {}],
            },
          },
        },
      }));

      const page = await searchPrs(state, ['acme/api'], 'repo:evil/other');

      expect(page).toEqual({ prs: [expect.objectContaining({ prNumber: 1 })], hasMore: false });
    });

    it('[FR-INBOX-660] should map merged and closed states and a deleted author', async () => {
      stub.reply(() => ({
        body: {
          data: {
            search: {
              issueCount: 2,
              nodes: [
                rawPr('acme/api', 1, { state: 'MERGED', author: null }),
                rawPr('acme/api', 2, { state: 'CLOSED' }),
              ],
            },
          },
        },
      }));

      const page = await searchPrs(state, ['acme/api'], 'is:closed');

      expect(page.prs.map(({ state: prState, author }) => ({ prState, author }))).toEqual([
        { prState: 'merged', author: 'ghost' },
        { prState: 'closed', author: 'alice' },
      ]);
    });

    it('[FR-INBOX-660] should return nothing and call GitHub never when no repo is given', async () => {
      const page = await searchPrs(state, [], 'anything');

      expect(page).toEqual({ prs: [], hasMore: false });
      expect(stub.requests).toHaveLength(0);
    });

    it('[FR-INBOX-650] should look a PR number up in every given repo and skip the misses', async () => {
      stub.reply((req) => {
        const { variables } = JSON.parse(req.body) as GraphqlBody;
        if (variables.name === 'web') return NOT_FOUND;
        return {
          body: {
            data: { repository: { pullRequest: rawPr('acme/api', 42, { state: 'MERGED' }) } },
          },
        };
      });

      const page = await searchPrs(state, ['acme/api', 'acme/web'], '#42');

      expect(bodies().map((body) => body.variables)).toEqual([
        { owner: 'acme', name: 'api', number: 42 },
        { owner: 'acme', name: 'web', number: 42 },
      ]);
      expect(page).toEqual({
        hasMore: false,
        prs: [expect.objectContaining({ repoFullName: 'acme/api', prNumber: 42, state: 'merged' })],
      });
    });

    it('[FR-INBOX-650] should look a PR URL up only in its own repo', async () => {
      stub.reply(() => ({
        body: { data: { repository: { pullRequest: rawPr('acme/web', 9) } } },
      }));

      const page = await searchPrs(
        state,
        ['acme/api', 'acme/web'],
        'https://github.com/Acme/Web/pull/9',
      );

      expect(bodies().map((body) => body.variables)).toEqual([
        { owner: 'Acme', name: 'Web', number: 9 },
      ]);
      expect(page.prs.map((pr) => pr.prNumber)).toEqual([9]);
    });

    it('[FR-INBOX-650] should return nothing for a PR URL of a repo outside the given repos', async () => {
      const page = await searchPrs(state, ['acme/api'], 'https://github.com/evil/other/pull/1');

      expect(page).toEqual({ prs: [], hasMore: false });
      expect(stub.requests).toHaveLength(0);
    });

    it('[FR-INBOX-650] should skip a repo the token cannot read', async () => {
      stub.reply((req) => {
        const { variables } = JSON.parse(req.body) as GraphqlBody;
        if (variables.name === 'secret') {
          return { body: { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] } };
        }
        return { body: { data: { repository: { pullRequest: rawPr('acme/api', 5) } } } };
      });

      const page = await searchPrs(state, ['acme/secret', 'acme/api'], '5');

      expect(page.prs.map((pr) => pr.repoFullName)).toEqual(['acme/api']);
    });

    it('should rethrow other lookup errors', async () => {
      stub.reply(() => ({
        body: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
      }));

      await expect(searchPrs(state, ['acme/api'], '5')).rejects.toThrow('API rate limit exceeded');
    });
  });
});
