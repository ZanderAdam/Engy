import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { listOpenPrs, resolveRepoPrs, deriveCiStatus, normalizeCheck, type GithubPr } from './prs';
import { rawPr, searchReply, searchQuery } from './pr-fixtures';
import { startStubGithub, type StubGithub } from './stub-server';

const AUTHORED = 'is:pr is:open author:@me';
const REVIEW_REQUESTED = 'is:pr is:open review-requested:@me';

describe('github prs', () => {
  let stub: StubGithub;
  let state: AppState;

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

  describe('listOpenPrs', () => {
    it('[FR-PRMON-190] should run one search per scope and flag authored PRs', async () => {
      stub.reply((request) => {
        if (searchQuery(request) === AUTHORED) return searchReply([rawPr({ number: 1 })]);
        return searchReply([rawPr({ number: 2, author: { login: 'bob' } })]);
      });

      const prs = await listOpenPrs(state);

      expect(stub.requests.map(searchQuery).sort()).toEqual([AUTHORED, REVIEW_REQUESTED].sort());
      expect(prs.map((pr) => [pr.number, pr.authoredByViewer])).toEqual([
        [1, true],
        [2, false],
      ]);
    });

    it('[FR-PRMON-190] should dedupe a PR that matches both searches as authored', async () => {
      stub.reply(() => searchReply([rawPr({ number: 7 })]));

      const prs = await listOpenPrs(state);

      expect(prs).toHaveLength(1);
      expect(prs[0].authoredByViewer).toBe(true);
    });

    it('should keep PRs with the same number in different repos', async () => {
      stub.reply((request) =>
        searchQuery(request) === AUTHORED
          ? searchReply([
              rawPr({ number: 1, repository: { nameWithOwner: 'org/a' } }),
              rawPr({ number: 1, repository: { nameWithOwner: 'org/b' } }),
            ])
          : searchReply([]),
      );

      const prs = await listOpenPrs(state);

      expect(prs.map((pr) => pr.repoFullName)).toEqual(['org/a', 'org/b']);
    });

    it('[FR-PRMON-180] [FR-PRMON-320] should map PR fields, review requests and discussion volume', async () => {
      stub.reply((request) =>
        searchQuery(request) === AUTHORED
          ? searchReply([
              rawPr({
                number: 5,
                title: 'Add thing',
                headRefName: 'feat/thing',
                headRefOid: 'deadbeef',
                baseRefName: 'develop',
                isDraft: true,
                mergeable: 'CONFLICTING',
                reviewDecision: 'REVIEW_REQUIRED',
                additions: 40,
                deletions: 9,
                comments: { totalCount: 2 },
                reviews: { nodes: [{ body: 'Please fix' }, { body: '  ' }, { body: '' }] },
                reviewRequests: {
                  nodes: [
                    { requestedReviewer: { __typename: 'User', login: 'octo' } },
                    {
                      requestedReviewer: {
                        __typename: 'Team',
                        slug: 'core',
                        organization: { login: 'org' },
                      },
                    },
                    { requestedReviewer: null },
                  ],
                },
              }),
            ])
          : searchReply([]),
      );

      const [pr] = await listOpenPrs(state);

      expect(pr).toEqual<GithubPr>({
        repoFullName: 'org/repo',
        number: 5,
        title: 'Add thing',
        url: 'https://github.com/org/repo/pull/1',
        headBranch: 'feat/thing',
        headSha: 'deadbeef',
        baseBranch: 'develop',
        author: 'alice',
        isDraft: true,
        reviewDecision: 'REVIEW_REQUIRED',
        ciStatus: 'unknown',
        checks: [],
        commentCount: 3,
        authoredByViewer: true,
        additions: 40,
        deletions: 9,
        reviewRequests: ['octo', 'org/core'],
        updatedAt: '2024-01-01T00:00:00Z',
        hasConflicts: true,
        isCrossRepository: false,
      });
    });

    it('should derive ciStatus and checks from the status rollup', async () => {
      const rollup = {
        contexts: {
          nodes: [
            {
              __typename: 'CheckRun',
              name: 'build',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
              detailsUrl: 'https://github.com/org/repo/actions/runs/1/job/2',
              completedAt: '2026-01-01T02:00:00Z',
            },
            {
              __typename: 'StatusContext',
              context: 'ci/legacy',
              state: 'SUCCESS',
              targetUrl: null,
              createdAt: '2026-01-01T01:00:00Z',
            },
          ],
        },
      };
      stub.reply((request) =>
        searchQuery(request) === AUTHORED
          ? searchReply([
              rawPr({ commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] } }),
            ])
          : searchReply([]),
      );

      const [pr] = await listOpenPrs(state);

      expect(pr.ciStatus).toBe('failing');
      expect(pr.checks).toEqual([
        {
          name: 'build',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/org/repo/actions/runs/1/job/2',
          completedAt: '2026-01-01T02:00:00Z',
        },
        {
          name: 'ci/legacy',
          status: 'SUCCESS',
          conclusion: null,
          detailsUrl: null,
          completedAt: '2026-01-01T01:00:00Z',
        },
      ]);
    });

    it('should drop closed PRs that search briefly returns', async () => {
      stub.reply((request) =>
        searchQuery(request) === AUTHORED
          ? searchReply([rawPr({ number: 1, state: 'CLOSED' }), rawPr({ number: 2 })])
          : searchReply([]),
      );

      const prs = await listOpenPrs(state);

      expect(prs.map((pr) => pr.number)).toEqual([2]);
    });

    it('should page each search up to 100 PRs', async () => {
      stub.reply((request) => {
        if (searchQuery(request) !== AUTHORED) return searchReply([]);
        const { after } = (JSON.parse(request.body) as { variables: { after: string | null } })
          .variables;
        if (after === null) {
          return searchReply([rawPr({ number: 1 })], { hasNextPage: true, endCursor: 'c1' });
        }
        return searchReply([rawPr({ number: 2 })], { hasNextPage: true, endCursor: 'c2' });
      });

      const prs = await listOpenPrs(state);

      expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
      const authoredRequests = stub.requests.filter((r) => searchQuery(r) === AUTHORED);
      expect(authoredRequests).toHaveLength(2);
    });
  });

  describe('deriveCiStatus', () => {
    const run = (status: string, conclusion: string | null) => ({
      __typename: 'CheckRun' as const,
      name: 'job',
      status,
      conclusion,
      detailsUrl: null,
    });

    it('[FR-PRMON-010] should return unknown for an empty rollup', () => {
      expect(deriveCiStatus(null)).toBe('unknown');
      expect(deriveCiStatus([])).toBe('unknown');
    });

    it('[FR-PRMON-010] should return pending when a check is still running', () => {
      expect(deriveCiStatus([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS', null)])).toBe(
        'pending',
      );
    });

    it.each(['WAITING', 'REQUESTED'])(
      '[FR-PRMON-010] should return pending for a check run with status %s',
      (status) => {
        expect(deriveCiStatus([run('COMPLETED', 'SUCCESS'), run(status, null)])).toBe('pending');
      },
    );

    it('[FR-PRMON-010] should return failing for a failing conclusion even when others pend', () => {
      expect(deriveCiStatus([run('QUEUED', null), run('COMPLETED', 'TIMED_OUT')])).toBe('failing');
    });

    it('[FR-PRMON-010] should return failing for an errored status context', () => {
      const errored = {
        __typename: 'StatusContext' as const,
        context: 'x',
        state: 'ERROR',
        targetUrl: null,
      };
      expect(deriveCiStatus([errored])).toBe('failing');
    });

    it('[FR-PRMON-010] should return passing when every check succeeded', () => {
      expect(deriveCiStatus([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED')])).toBe(
        'passing',
      );
    });
  });

  describe('normalizeCheck', () => {
    it('[FR-PRMON-010] should keep the completion time of a check run', () => {
      const check = normalizeCheck({
        __typename: 'CheckRun',
        name: 'job',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: null,
        completedAt: '2026-01-01T02:00:00Z',
      });
      expect(check.completedAt).toBe('2026-01-01T02:00:00Z');
    });

    it('[FR-PRMON-010] should use the creation time of a status context', () => {
      const check = normalizeCheck({
        __typename: 'StatusContext',
        context: 'ci',
        state: 'FAILURE',
        targetUrl: null,
        createdAt: '2026-01-01T03:00:00Z',
      });
      expect(check.completedAt).toBe('2026-01-01T03:00:00Z');
    });
  });

  describe('resolveRepoPrs', () => {
    const prs = [
      { repoFullName: 'Org/Repo', number: 1 },
      { repoFullName: 'org/other', number: 2 },
    ] as GithubPr[];

    it('should keep PRs of the repo, ignoring name case', async () => {
      state.repoFullNames.set('/repo', 'org/repo');

      const result = await resolveRepoPrs(state, '/repo', prs);

      expect(result.map((pr) => pr.number)).toEqual([1]);
    });

    it('should fail with a clear message when the repo has no GitHub remote', async () => {
      state.repoFullNames.set('/repo', null);

      await expect(resolveRepoPrs(state, '/repo', prs)).rejects.toThrow(
        'No GitHub remote found for /repo',
      );
    });
  });
});
