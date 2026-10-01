import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { inboxEvents, inboxItems, workspaces } from '../db/schema';
import type { GithubNotification } from '../github/notifications';
import {
  startStubGithub,
  type StubGithub,
  type StubReply,
  type StubRequest,
} from '../github/stub-server';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { maybeStartAutoReview } from '../review/auto-review';
import * as broadcast from '../ws/broadcast';
import {
  MIN_POLL_INTERVAL_MS,
  createNotificationsSession,
  runNotificationsCycle,
} from './notifications-poller';

vi.mock('../review/auto-review', () => ({ maybeStartAutoReview: vi.fn() }));

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const NOW = new Date('2026-03-01T12:00:00.000Z');

function notification(overrides: Partial<GithubNotification> = {}): GithubNotification {
  return {
    id: '100',
    unread: true,
    reason: 'review_requested',
    updated_at: '2026-03-01T11:00:00Z',
    last_read_at: null,
    subject: {
      title: 'Fix it',
      url: 'https://api.github.com/repos/acme/api/pulls/7',
      type: 'PullRequest',
    },
    repository: { full_name: 'acme/api' },
    ...overrides,
  };
}

function timelineReply(nodes: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    body: {
      data: {
        repository: {
          pullRequest: {
            title: 'Fix it (fresh)',
            url: 'https://github.com/acme/api/pull/7',
            state: 'OPEN',
            reviewDecision: null,
            author: { login: 'alice' },
            reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'me' } }] },
            timelineItems: { nodes },
            ...overrides,
          },
        },
      },
    },
  };
}

const REVIEW_REQUEST_NODE = {
  __typename: 'ReviewRequestedEvent',
  id: 'RRE_1',
  createdAt: '2026-03-01T10:59:00Z',
  actor: { login: 'alice' },
  requestedReviewer: { __typename: 'User', login: 'me' },
};

describe('notifications poller', () => {
  let ctx: TestContext;
  let stub: StubGithub;
  let notifications: GithubNotification[];
  let notificationsReply: (req: StubRequest) => StubReply;
  let timeline: () => StubReply;

  beforeEach(async () => {
    ctx = setupTestDb();
    vi.mocked(maybeStartAutoReview).mockResolvedValue({ started: false, reason: 'setting-off' });
    vi.spyOn(broadcast, 'broadcastInboxChange').mockImplementation(() => undefined);
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = TOKEN;

    notifications = [];
    notificationsReply = () => ({ body: notifications });
    timeline = () => timelineReply([REVIEW_REQUEST_NODE]);
    stub.reply((req) => {
      if (req.url === '/user') {
        return { headers: { 'x-oauth-scopes': 'repo, notifications' }, body: { login: 'me' } };
      }
      if (req.url.startsWith('/notifications')) return notificationsReply(req);
      return timeline();
    });
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
    ctx.cleanup();
    vi.restoreAllMocks();
    vi.mocked(maybeStartAutoReview).mockReset();
  });

  function items() {
    return ctx.db.select().from(inboxItems).all();
  }

  function events() {
    return ctx.db.select().from(inboxEvents).all();
  }

  function graphqlCalls(): number {
    return stub.requests.filter((req) => req.url === '/graphql').length;
  }

  it('[FR-INBOX-260] should import pull request threads with timeline events and bucket', async () => {
    const workspaceId = ctx.db
      .insert(workspaces)
      .values({ name: 'w', slug: 'w', repos: ['/repos/api'] })
      .returning()
      .get().id;
    ctx.state.repoFullNames.set('/repos/api', 'acme/api');
    notifications = [notification()];

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(items()).toEqual([
      expect.objectContaining({
        repoFullName: 'acme/api',
        prNumber: 7,
        githubThreadId: '100',
        title: 'Fix it (fresh)',
        url: 'https://github.com/acme/api/pull/7',
        workspaceId,
        repoPath: '/repos/api',
        bucket: 'priority',
        unread: true,
        latestReason: 'review_requested',
      }),
    ]);
    expect(events()).toEqual([
      expect.objectContaining({
        kind: 'review_requested',
        summary: 'alice requested your review',
        sourceKey: 'gh:RRE_1',
      }),
    ]);
  });

  it('[FR-INBOX-260] should drop non pull request threads and ci_activity', async () => {
    notifications = [
      notification({
        id: '1',
        subject: { title: 'Issue', url: 'https://x/issues/2', type: 'Issue' },
      }),
      notification({ id: '2', reason: 'ci_activity' }),
    ];

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(items()).toEqual([]);
    expect(graphqlCalls()).toBe(0);
  });

  it('[FR-INBOX-270] should do no work on 304 and skip unchanged threads', async () => {
    notifications = [notification()];
    const session = createNotificationsSession();
    await runNotificationsCycle(ctx.state, session, NOW);
    expect(graphqlCalls()).toBe(1);

    notificationsReply = () => ({ status: 304 });
    await runNotificationsCycle(ctx.state, session, new Date(NOW.getTime() + 60_000));
    notificationsReply = () => ({ body: notifications });
    await runNotificationsCycle(ctx.state, session, new Date(NOW.getTime() + 120_000));

    expect(graphqlCalls()).toBe(1);
    const polls = stub.requests.filter((req) => req.url.startsWith('/notifications'));
    expect(polls[0].url).toContain('all=false');
    expect(polls[1].url).toContain('all=true&per_page=50&since=2026-03-01T12%3A00%3A00.000Z');
  });

  it('[FR-INBOX-280] should honor X-Poll-Interval but never go below 60 seconds', async () => {
    const session = createNotificationsSession();

    notificationsReply = () => ({ headers: { 'x-poll-interval': '300' }, body: [] });
    expect(await runNotificationsCycle(ctx.state, session, NOW)).toBe(300_000);

    notificationsReply = () => ({ headers: { 'x-poll-interval': '10' }, body: [] });
    expect(await runNotificationsCycle(ctx.state, session, NOW)).toBe(MIN_POLL_INTERVAL_MS);
  });

  it('[FR-INBOX-280] should keep the previous interval on 304', async () => {
    const session = createNotificationsSession();
    notificationsReply = () => ({ headers: { 'x-poll-interval': '180' }, body: [] });
    await runNotificationsCycle(ctx.state, session, NOW);

    notificationsReply = () => ({ status: 304 });

    expect(await runNotificationsCycle(ctx.state, session, NOW)).toBe(180_000);
  });

  it('[FR-INBOX-270] should not duplicate events after a restart', async () => {
    notifications = [notification()];
    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(events()).toHaveLength(1);
    expect(items()).toHaveLength(1);
  });

  it('[FR-INBOX-290] should fall back to a reason event when the timeline has nothing', async () => {
    timeline = () => timelineReply([]);
    notifications = [notification({ reason: 'mention' })];

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(events()).toEqual([
      expect.objectContaining({
        kind: 'mentioned',
        sourceKey: 'ghn:100:2026-03-01T11:00:00Z',
      }),
    ]);
    expect(items()[0].bucket).toBe('priority');
  });

  it('[FR-INBOX-240] should skip events authored by the viewer', async () => {
    timeline = () =>
      timelineReply([
        {
          __typename: 'IssueComment',
          id: 'IC_1',
          createdAt: '2026-03-01T10:00:00Z',
          body: 'mine',
          author: { login: 'me' },
        },
      ]);
    notifications = [notification({ reason: 'comment' })];

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(events().map((event) => event.sourceKey)).toEqual(['ghn:100:2026-03-01T11:00:00Z']);
  });

  it('[FR-INBOX-310] should mark an item read when GitHub read it after the last event', async () => {
    notifications = [notification()];
    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);
    const itemId = items()[0].id;
    ctx.db
      .update(inboxItems)
      .set({ lastEventAt: '2026-03-01T11:00:00Z' })
      .where(eq(inboxItems.id, itemId))
      .run();

    notifications = [
      notification({
        unread: false,
        updated_at: '2026-03-01T11:30:00Z',
        last_read_at: '2026-03-01T11:45:00Z',
      }),
    ];
    timeline = () => timelineReply([]);
    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(items()[0].unread).toBe(false);
  });

  it('[FR-INBOX-300] should compute viewer-authored PR facts', async () => {
    timeline = () =>
      timelineReply(
        [
          {
            __typename: 'PullRequestReview',
            id: 'PRR_1',
            submittedAt: '2026-03-01T10:00:00Z',
            state: 'CHANGES_REQUESTED',
            author: { login: 'bob' },
          },
        ],
        {
          author: { login: 'me' },
          reviewDecision: 'CHANGES_REQUESTED',
          reviewRequests: { nodes: [] },
        },
      );
    notifications = [notification({ reason: 'author' })];

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(items()[0].bucket).toBe('priority');
    expect(items()[0].latestReason).toBe('changes_requested');
  });

  it('[FR-INBOX-320] should skip the cycle when GitHub is unavailable', async () => {
    delete process.env.ENGY_GITHUB_TOKEN;

    await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

    expect(stub.requests).toEqual([]);
  });

  describe('auto review', () => {
    function mapWorkspace(): number {
      ctx.state.repoFullNames.set('/repos/api', 'acme/api');
      return ctx.db
        .insert(workspaces)
        .values({ name: 'w', slug: 'w', repos: ['/repos/api'] })
        .returning()
        .get().id;
    }

    it('[FR-PRMON-301] should start an auto review for a new review request in a workspace repo', async () => {
      const workspaceId = mapWorkspace();
      notifications = [notification()];

      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      expect(maybeStartAutoReview).toHaveBeenCalledTimes(1);
      expect(maybeStartAutoReview).toHaveBeenCalledWith(ctx.state, {
        workspaceId,
        repoFullName: 'acme/api',
        prNumber: 7,
      });
    });

    it('[FR-PRMON-301] should not start an auto review for a repo outside every workspace', async () => {
      notifications = [notification()];

      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      expect(maybeStartAutoReview).not.toHaveBeenCalled();
    });

    it('[FR-PRMON-301] should not start an auto review for other event kinds', async () => {
      mapWorkspace();
      timeline = () => timelineReply([]);
      notifications = [notification({ reason: 'mention' })];

      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      expect(maybeStartAutoReview).not.toHaveBeenCalled();
    });

    it('[FR-PRMON-301] should not start a second auto review for an event already stored', async () => {
      mapWorkspace();
      notifications = [notification()];
      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      expect(maybeStartAutoReview).toHaveBeenCalledTimes(1);
    });

    it('[FR-PRMON-301] should keep syncing when the auto review fails', async () => {
      mapWorkspace();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(maybeStartAutoReview).mockRejectedValue(new Error('boom'));
      notifications = [notification()];

      await runNotificationsCycle(ctx.state, createNotificationsSession(), NOW);

      expect(items()).toHaveLength(1);
    });
  });
});
