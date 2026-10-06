import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { fetchReviewThreads } from './review-threads';
import { startStubGithub, type StubGithub } from './stub-server';

const rawThread = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 10,
  originalLine: 8,
  diffSide: 'RIGHT',
  startLine: null,
  comments: {
    nodes: [
      {
        id: `${id}-c1`,
        databaseId: 101,
        body: 'first',
        author: { login: 'reviewer' },
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        url: 'https://github.com/org/repo/pull/7#discussion_r101',
        replyTo: null,
      },
      {
        id: `${id}-c2`,
        databaseId: 102,
        body: 'second',
        author: null,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
        url: 'https://github.com/org/repo/pull/7#discussion_r102',
        replyTo: { databaseId: 101 },
      },
    ],
  },
  ...overrides,
});

const page = (nodes: unknown[], endCursor: string | null) => ({
  body: {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes },
        },
      },
    },
  },
});

describe('github review threads', () => {
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

  it('[FR-PRMON-150] should read every page of review threads through GraphQL', async () => {
    stub.reply((request) => {
      const { variables } = JSON.parse(request.body);
      if (variables.after === 'cursor-1') return page([rawThread('T2')], null);
      return page([rawThread('T1')], 'cursor-1');
    });

    const threads = await fetchReviewThreads(state, 'org/repo', 7);

    expect(threads.map((t) => t.nodeId)).toEqual(['T1', 'T2']);
    const variables = JSON.parse(stub.requests[0].body).variables;
    expect(variables).toMatchObject({ owner: 'org', name: 'repo', number: 7 });
  });

  it('[FR-PRMON-150] should map thread state, line anchors and ordered comments', async () => {
    stub.reply(() =>
      page([rawThread('T1', { isResolved: true, isOutdated: true, line: null })], null),
    );

    const [thread] = await fetchReviewThreads(state, 'org/repo', 7);

    expect(thread).toMatchObject({
      nodeId: 'T1',
      isResolved: true,
      isOutdated: true,
      line: null,
      originalLine: 8,
      diffSide: 'RIGHT',
    });
    expect(thread.comments.map((c) => [c.githubId, c.replyToId])).toEqual([
      [101, null],
      [102, 101],
    ]);
    expect(thread.comments[0].author).toBe('reviewer');
    expect(thread.comments[1].author).toBe('ghost');
  });

  it('should return an empty list when the pull request is missing', async () => {
    stub.reply(() => ({ body: { data: { repository: { pullRequest: null } } } }));

    expect(await fetchReviewThreads(state, 'org/repo', 7)).toEqual([]);
  });
});
