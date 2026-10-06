import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { buildConversation, CONVERSATION_LIMIT, fetchPrDetail } from './pr-detail';
import { startStubGithub, type StubGithub } from './stub-server';

const actor = (login: string) => ({ login, avatarUrl: `https://avatars/${login}` });

const rawComment = (id: string, createdAt: string, overrides = {}) => ({
  id,
  author: actor('alice'),
  body: `comment ${id}`,
  createdAt,
  url: `https://github.com/org/repo/pull/7#${id}`,
  ...overrides,
});

const rawReview = (id: string, createdAt: string, overrides = {}) => ({
  id,
  author: actor('bob'),
  state: 'APPROVED',
  body: '',
  submittedAt: createdAt,
  createdAt,
  url: `https://github.com/org/repo/pull/7#${id}`,
  ...overrides,
});

const rawCommit = (oid: string, committedDate: string, overrides = {}) => ({
  commit: {
    oid,
    messageHeadline: `commit ${oid}`,
    committedDate,
    url: `https://github.com/org/repo/commit/${oid}`,
    author: { name: 'Carol', user: actor('carol') },
    ...overrides,
  },
});

function rawDetail(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Add feature',
    body: '## Summary\nHello',
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/org/repo/pull/7',
    createdAt: '2024-01-01T00:00:00Z',
    author: actor('alice'),
    baseRefName: 'main',
    headRefName: 'feat/seven',
    headRefOid: 'abcdef1234567890',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
    reviewRequests: {
      nodes: [
        { requestedReviewer: { __typename: 'User', login: 'dave', avatarUrl: 'https://a/dave' } },
        {
          requestedReviewer: {
            __typename: 'Team',
            slug: 'core',
            avatarUrl: 'https://a/core',
            organization: { login: 'org' },
          },
        },
        { requestedReviewer: null },
      ],
    },
    assignees: { nodes: [actor('erin')] },
    labels: { nodes: [{ name: 'bug', color: 'ff0000' }] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    commits: { nodes: [] },
    lastCommit: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'build',
                    status: 'COMPLETED',
                    conclusion: 'FAILURE',
                    detailsUrl: 'https://ci/build',
                  },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('buildConversation', () => {
  it('should merge comments, reviews and commits oldest first', () => {
    const items = buildConversation({
      comments: [rawComment('c1', '2024-01-03T00:00:00Z')],
      reviews: [rawReview('r1', '2024-01-04T00:00:00Z', { state: 'CHANGES_REQUESTED' })],
      commits: [rawCommit('0123456789abcdef', '2024-01-02T00:00:00Z')],
    });

    expect(items.map((item) => [item.kind, item.id])).toEqual([
      ['commit', '0123456789abcdef'],
      ['comment', 'c1'],
      ['review', 'r1'],
    ]);
    expect(items[0]).toMatchObject({ oid: '0123456', headline: 'commit 0123456789abcdef' });
    expect(items[2]).toMatchObject({ state: 'CHANGES_REQUESTED' });
  });

  it('should drop pending reviews and date a review by its submission time', () => {
    const items = buildConversation({
      comments: [],
      reviews: [
        rawReview('draft', '2024-01-02T00:00:00Z', { state: 'PENDING', submittedAt: null }),
        rawReview('sent', '2024-01-01T00:00:00Z', { submittedAt: '2024-01-05T00:00:00Z' }),
      ],
      commits: [],
    });

    expect(items).toEqual([
      expect.objectContaining({ id: 'sent', createdAt: '2024-01-05T00:00:00Z' }),
    ]);
  });

  it('should keep the newest items when over the cap', () => {
    const comments = Array.from({ length: CONVERSATION_LIMIT + 5 }, (_, i) =>
      rawComment(`c${i}`, new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString()),
    );

    const items = buildConversation({ comments, reviews: [], commits: [] });

    expect(items).toHaveLength(CONVERSATION_LIMIT);
    expect(items[0].id).toBe('c5');
    expect(items.at(-1)?.id).toBe(`c${CONVERSATION_LIMIT + 4}`);
  });

  it('should fall back to the git author name and null for a deleted account', () => {
    const items = buildConversation({
      comments: [rawComment('c1', '2024-01-03T00:00:00Z', { author: null })],
      reviews: [],
      commits: [
        rawCommit('aaaaaaaaaa', '2024-01-01T00:00:00Z', { author: { name: 'Carol', user: null } }),
        rawCommit('bbbbbbbbbb', '2024-01-02T00:00:00Z', { author: null }),
      ],
    });

    expect(items.map((item) => item.author)).toEqual([
      { login: 'Carol', avatarUrl: null },
      null,
      null,
    ]);
  });
});

describe('fetchPrDetail', () => {
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

  it('should map the GraphQL response into a PR detail', async () => {
    stub.reply(() => ({
      body: {
        data: {
          repository: {
            pullRequest: rawDetail({
              comments: { nodes: [rawComment('c1', '2024-01-02T00:00:00Z')] },
            }),
          },
        },
      },
    }));

    const detail = await fetchPrDetail(state, 'org/repo', 7);

    expect(detail).toMatchObject({
      title: 'Add feature',
      body: '## Summary\nHello',
      baseRefName: 'main',
      headRefName: 'feat/seven',
      headRefOid: 'abcdef1234567890',
      changedFiles: 3,
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      author: { login: 'alice', avatarUrl: 'https://avatars/alice' },
      assignees: [{ login: 'erin', avatarUrl: 'https://avatars/erin' }],
      labels: [{ name: 'bug', color: 'ff0000' }],
      ciStatus: 'failing',
      checks: [
        {
          name: 'build',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: 'https://ci/build',
        },
      ],
      reviewRequests: [
        { login: 'dave', avatarUrl: 'https://a/dave', isTeam: false },
        { login: 'org/core', avatarUrl: 'https://a/core', isTeam: true },
      ],
    });
    expect(detail.conversation).toEqual([expect.objectContaining({ kind: 'comment', id: 'c1' })]);
    const { variables } = JSON.parse(stub.requests[0].body);
    expect(variables).toMatchObject({ owner: 'org', name: 'repo', number: 7 });
  });

  it('should report unknown CI when the head commit has no checks', async () => {
    stub.reply(() => ({
      body: {
        data: {
          repository: {
            pullRequest: rawDetail({
              lastCommit: { nodes: [{ commit: { statusCheckRollup: null } }] },
            }),
          },
        },
      },
    }));

    const detail = await fetchPrDetail(state, 'org/repo', 7);

    expect(detail.ciStatus).toBe('unknown');
    expect(detail.checks).toEqual([]);
  });

  it('should throw not_found when the PR does not exist', async () => {
    stub.reply(() => ({ body: { data: { repository: { pullRequest: null } } } }));

    await expect(fetchPrDetail(state, 'org/repo', 7)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
