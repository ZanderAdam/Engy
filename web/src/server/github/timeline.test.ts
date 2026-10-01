import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState } from '../trpc/context';
import { startStubGithub, type StubGithub } from './stub-server';
import { fetchPrTimeline, mapTimelineNodes, mentionsViewer, type TimelineNode } from './timeline';

const VIEWER = 'me';

function summaries(nodes: TimelineNode[]): string[] {
  return mapTimelineNodes(nodes, VIEWER).map((event) => `${event.kind}: ${event.summary}`);
}

describe('[FR-INBOX-200] mentionsViewer', () => {
  it.each([
    ['hey @me please look', true],
    ['@ME shouting', true],
    ['(@me)', true],
    ['@me.', true],
    ['ping @mellow', false],
    ['mail me@example.com', false],
    ['@me-too is someone else', false],
    ['no mention', false],
    [undefined, false],
  ])('should match %j -> %s', (body, expected) => {
    expect(mentionsViewer(body, VIEWER)).toBe(expected);
  });

  it('should escape regex characters in the login', () => {
    expect(mentionsViewer('hi @a.b', 'a.b')).toBe(true);
    expect(mentionsViewer('hi @axb', 'a.b')).toBe(false);
  });
});

describe('mapTimelineNodes', () => {
  it('[FR-INBOX-210] should map reviews by state', () => {
    const nodes: TimelineNode[] = [
      {
        __typename: 'PullRequestReview',
        id: 'r1',
        submittedAt: '2026-01-01T00:00:01Z',
        state: 'APPROVED',
        author: { login: 'alice' },
        url: 'https://x/r1',
      },
      {
        __typename: 'PullRequestReview',
        id: 'r2',
        submittedAt: '2026-01-01T00:00:02Z',
        state: 'CHANGES_REQUESTED',
        author: { login: 'bob' },
      },
      {
        __typename: 'PullRequestReview',
        id: 'r3',
        submittedAt: '2026-01-01T00:00:03Z',
        state: 'COMMENTED',
        author: { login: 'bob' },
        comments: { nodes: [{ path: 'foo.ts', line: 42 }] },
      },
      {
        __typename: 'PullRequestReview',
        id: 'r4',
        submittedAt: '2026-01-01T00:00:04Z',
        state: 'COMMENTED',
        author: { login: 'bob' },
        comments: { nodes: [] },
      },
      {
        __typename: 'PullRequestReview',
        id: 'r5',
        submittedAt: null,
        state: 'PENDING',
        author: { login: 'bob' },
      },
    ];

    expect(summaries(nodes)).toEqual([
      'approved: alice approved',
      'changes_requested: bob requested changes',
      'commented: bob commented on foo.ts:42',
      'reviewed: bob reviewed',
    ]);
    expect(mapTimelineNodes(nodes, VIEWER)[0]).toMatchObject({
      sourceKey: 'gh:r1',
      actor: 'alice',
      url: 'https://x/r1',
      at: '2026-01-01T00:00:01Z',
    });
  });

  it('[FR-INBOX-210] should map comments and turn viewer mentions into mentioned events', () => {
    const nodes: TimelineNode[] = [
      {
        __typename: 'IssueComment',
        id: 'c1',
        createdAt: '2026-01-01T00:00:01Z',
        body: 'looks fine',
        author: { login: 'alice' },
      },
      {
        __typename: 'IssueComment',
        id: 'c2',
        createdAt: '2026-01-01T00:00:02Z',
        body: 'thoughts @Me?',
        author: { login: 'alice' },
      },
      {
        __typename: 'PullRequestReview',
        id: 'r1',
        submittedAt: '2026-01-01T00:00:03Z',
        state: 'COMMENTED',
        body: '@me ptal',
        author: { login: 'bob' },
      },
    ];

    expect(summaries(nodes)).toEqual([
      'commented: alice commented',
      'mentioned: alice mentioned you',
      'mentioned: bob mentioned you',
    ]);
  });

  it('[FR-INBOX-220] should keep review requests only for the viewer', () => {
    const nodes: TimelineNode[] = [
      {
        __typename: 'ReviewRequestedEvent',
        id: 'q1',
        createdAt: '2026-01-01T00:00:01Z',
        actor: { login: 'alice' },
        requestedReviewer: { __typename: 'User', login: 'me' },
      },
      {
        __typename: 'ReviewRequestedEvent',
        id: 'q2',
        createdAt: '2026-01-01T00:00:02Z',
        actor: { login: 'alice' },
        requestedReviewer: { __typename: 'User', login: 'carol' },
      },
      {
        __typename: 'ReviewRequestedEvent',
        id: 'q3',
        createdAt: '2026-01-01T00:00:03Z',
        actor: { login: 'alice' },
        requestedReviewer: { __typename: 'Team', slug: 'core' },
      },
    ];

    expect(summaries(nodes)).toEqual(['review_requested: alice requested your review']);
  });

  it('[FR-INBOX-220] should map state changes, force pushes and assignments', () => {
    const nodes: TimelineNode[] = [
      {
        __typename: 'MergedEvent',
        id: 'm',
        createdAt: '2026-01-01T00:00:01Z',
        actor: { login: 'a' },
      },
      {
        __typename: 'ClosedEvent',
        id: 'x',
        createdAt: '2026-01-01T00:00:02Z',
        actor: { login: 'a' },
      },
      { __typename: 'ReopenedEvent', id: 'o', createdAt: '2026-01-01T00:00:03Z', actor: null },
      {
        __typename: 'HeadRefForcePushedEvent',
        id: 'f',
        createdAt: '2026-01-01T00:00:04Z',
        actor: { login: 'carol' },
      },
      {
        __typename: 'AssignedEvent',
        id: 'a1',
        createdAt: '2026-01-01T00:00:05Z',
        actor: { login: 'alice' },
        assignee: { __typename: 'User', login: 'me' },
      },
      {
        __typename: 'AssignedEvent',
        id: 'a2',
        createdAt: '2026-01-01T00:00:06Z',
        actor: { login: 'alice' },
        assignee: { __typename: 'User', login: 'other' },
      },
    ];

    expect(summaries(nodes)).toEqual([
      'merged: PR merged',
      'closed: PR closed',
      'reopened: PR reopened',
      'pushed: carol force-pushed',
      'assigned: alice assigned you',
    ]);
  });

  it('[FR-INBOX-230] should group commits per author into one pushed event', () => {
    const commit = (id: string, login: string, committedDate: string): TimelineNode => ({
      __typename: 'PullRequestCommit',
      id,
      commit: { committedDate, author: { user: { login } } },
    });

    const events = mapTimelineNodes(
      [
        commit('k1', 'carol', '2026-01-01T00:00:01Z'),
        commit('k2', 'carol', '2026-01-01T00:00:02Z'),
        commit('k3', 'me', '2026-01-01T00:00:03Z'),
        commit('k4', 'dave', '2026-01-01T00:00:04Z'),
      ],
      VIEWER,
    );

    expect(events.map((e) => e.summary)).toEqual([
      'carol pushed 2 commits',
      'dave pushed 1 commit',
    ]);
    expect(events[0]).toMatchObject({ sourceKey: 'gh:k2', at: '2026-01-01T00:00:02Z' });
  });

  it('[FR-INBOX-240] should skip events authored by the viewer and null nodes', () => {
    const nodes: Array<TimelineNode | null> = [
      null,
      {
        __typename: 'IssueComment',
        id: 'c1',
        createdAt: '2026-01-01T00:00:01Z',
        body: 'mine',
        author: { login: 'ME' },
      },
      { __typename: 'UnknownThing', id: 'u' },
    ];

    expect(mapTimelineNodes(nodes, VIEWER)).toEqual([]);
  });
});

describe('[FR-INBOX-250] fetchPrTimeline', () => {
  let stub: StubGithub;

  beforeEach(async () => {
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  const input = {
    owner: 'acme',
    name: 'api',
    number: 7,
    since: '2026-01-01T00:00:00Z',
    viewerLogin: VIEWER,
  };

  it('should send one query and map the pull request', async () => {
    stub.reply(() => ({
      body: {
        data: {
          repository: {
            pullRequest: {
              title: 'Fix it',
              url: 'https://github.com/acme/api/pull/7',
              state: 'OPEN',
              reviewDecision: null,
              author: { login: 'alice' },
              reviewRequests: {
                nodes: [{ requestedReviewer: { __typename: 'User', login: 'Me' } }],
              },
              timelineItems: {
                nodes: [
                  {
                    __typename: 'PullRequestReview',
                    id: 'r1',
                    submittedAt: '2026-01-02T00:00:00Z',
                    state: 'APPROVED',
                    author: { login: 'bob' },
                  },
                ],
              },
            },
          },
        },
      },
    }));

    const timeline = await fetchPrTimeline(createAppState(), input);

    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(stub.requests[0].body).variables).toEqual({
      owner: 'acme',
      name: 'api',
      number: 7,
      since: '2026-01-01T00:00:00Z',
    });
    expect(timeline).toMatchObject({
      title: 'Fix it',
      state: 'OPEN',
      authorLogin: 'alice',
      viewerReviewRequested: true,
    });
    expect(timeline?.events.map((e) => e.summary)).toEqual(['bob approved']);
  });

  it('should return null when the pull request is missing', async () => {
    stub.reply(() => ({ body: { data: { repository: { pullRequest: null } } } }));

    expect(await fetchPrTimeline(createAppState(), input)).toBeNull();
  });
});
