import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as broadcast from '../../ws/broadcast';
import { setupTestDb, type TestContext } from '../test-helpers';
import { appRouter } from '../root';
import { addEvent, upsertItem } from '../../inbox/store';
import { NO_BUCKET_FACTS } from '../../inbox/bucket';
import {
  agentSessions,
  commentThreads,
  projects,
  reviewWorktrees,
  taskGroups,
  workspaces,
} from '../../db/schema';
import { diffScopePrefix } from '../../../lib/diff-doc-path';
import { startStubGithub, type StubGithub } from '../../github/stub-server';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const PRIORITY_FACTS = { ...NO_BUCKET_FACTS, mentioned: true };

describe('inbox router', () => {
  let ctx: TestContext;
  let stub: StubGithub;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let prSeq = 0;

  function createItem(overrides: { githubThreadId?: string; priority?: boolean } = {}) {
    prSeq += 1;
    const item = upsertItem({
      repoFullName: 'acme/api',
      prNumber: prSeq,
      title: `PR ${prSeq}`,
      url: `https://github.com/acme/api/pull/${prSeq}`,
      githubThreadId: overrides.githubThreadId,
      facts: overrides.priority ? PRIORITY_FACTS : undefined,
    });
    addEvent({
      itemId: item.id,
      kind: 'commented',
      summary: `comment on ${prSeq}`,
      actor: 'octo',
      at: '2026-03-01T10:00:00.000Z',
      sourceKey: `k-${prSeq}-1`,
      facts: overrides.priority ? PRIORITY_FACTS : undefined,
    });
    return item;
  }

  beforeEach(async () => {
    ctx = setupTestDb();
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = TOKEN;
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
    ctx.cleanup();
  });

  describe('list', () => {
    describe('risk', () => {
      const REPO_PATH = '/repos/api';

      function createRepoItem() {
        prSeq += 1;
        return upsertItem({
          repoFullName: 'acme/api',
          prNumber: prSeq,
          title: `PR ${prSeq}`,
          url: `https://github.com/acme/api/pull/${prSeq}`,
          repoPath: REPO_PATH,
        });
      }

      function trackBranch(prNumber: number, headRefName: string, isCrossRepository = false) {
        ctx.db
          .insert(reviewWorktrees)
          .values({
            repoPath: REPO_PATH,
            repoFullName: 'acme/api',
            prNumber,
            worktreePath: `/wt/pr-${prNumber}`,
            headRefName,
            headSha: 'sha',
            createdByReview: true,
            isCrossRepository,
          })
          .run();
      }

      function writeSummary(branch: string, metadata: Record<string, unknown>) {
        ctx.db
          .insert(commentThreads)
          .values({
            id: `t-${branch}`,
            workspaceId: null,
            documentPath: diffScopePrefix(REPO_PATH, branch),
            metadata: { type: 'review-summary', ...metadata },
          })
          .run();
      }

      it('[FR-PRMON-302] should be null before the agent wrote a summary', async () => {
        const item = createRepoItem();
        trackBranch(item.prNumber, 'feat/a');

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.risk).toBeNull();
      });

      it('[FR-PRMON-302] should read the risk from the summary of the PR head branch', async () => {
        const item = createRepoItem();
        trackBranch(item.prNumber, 'feat/a');
        writeSummary('feat/a', { risk: { level: 'high', reason: 'touches auth' } });

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.risk).toEqual({ level: 'high', reason: 'touches auth' });
      });

      it('[FR-PRMON-302] should not read the risk of a same-repo PR for a fork PR with the same head branch name', async () => {
        const sameRepo = createRepoItem();
        const fork = createRepoItem();
        trackBranch(sameRepo.prNumber, 'main');
        trackBranch(fork.prNumber, 'main', true);
        writeSummary('main', { risk: { level: 'high', reason: 'same repo PR' } });

        const listed = await caller.inbox.list({ tab: 'all' });

        const risks = new Map(listed.map((entry) => [entry.prNumber, entry.risk]));
        expect(risks.get(sameRepo.prNumber)).toEqual({ level: 'high', reason: 'same repo PR' });
        expect(risks.get(fork.prNumber)).toBeNull();
      });

      it('[FR-PRMON-302] should read the risk of a fork PR from its own pull ref key', async () => {
        const fork = createRepoItem();
        trackBranch(fork.prNumber, 'main', true);
        writeSummary(`pull/${fork.prNumber}/head`, { risk: { level: 'high', reason: 'fork' } });

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.risk).toEqual({ level: 'high', reason: 'fork' });
      });

      it('[FR-PRMON-302] should ignore a summary without a valid risk level', async () => {
        const item = createRepoItem();
        trackBranch(item.prNumber, 'feat/a');
        writeSummary('feat/a', { risk: { level: 'scary', reason: 'x' } });

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.risk).toBeNull();
      });

      it('[FR-PRMON-302] should be null for an item outside every workspace repo', async () => {
        createItem();

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.risk).toBeNull();
      });
    });

    describe('projectSlug', () => {
      const REPO_PATH = '/repos/api';

      function createRepoItem() {
        prSeq += 1;
        return upsertItem({
          repoFullName: 'acme/api',
          prNumber: prSeq,
          title: `PR ${prSeq}`,
          url: `https://github.com/acme/api/pull/${prSeq}`,
          repoPath: REPO_PATH,
        });
      }

      function seedSession(branch: string, worktreePath: string) {
        const ws = ctx.db
          .insert(workspaces)
          .values({ name: 'WS', slug: 'ws', repos: [REPO_PATH] })
          .returning()
          .get();
        const project = ctx.db
          .insert(projects)
          .values({ workspaceId: ws.id, name: 'Auth', slug: 'auth' })
          .returning()
          .get();
        const group = ctx.db
          .insert(taskGroups)
          .values({ projectId: project.id, name: 'TG' })
          .returning()
          .get();
        ctx.db
          .insert(agentSessions)
          .values({ sessionId: 'sess-1', taskGroupId: group.id, branch, worktreePath })
          .run();
      }

      function trackBranch(prNumber: number, headRefName: string) {
        ctx.db
          .insert(reviewWorktrees)
          .values({
            repoPath: REPO_PATH,
            repoFullName: 'acme/api',
            prNumber,
            worktreePath: `/wt/pr-${prNumber}`,
            headRefName,
            headSha: 'sha',
            createdByReview: true,
          })
          .run();
      }

      it('[FR-INBOX-390] [FR-PRMON-040] should return the project slug of the session that worked on the PR branch', async () => {
        const item = createRepoItem();
        trackBranch(item.prNumber, 'feat/a');
        seedSession('feat/a', `${REPO_PATH}/.worktrees/engy-session-1`);

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.projectSlug).toBe('auth');
      });

      it('[FR-INBOX-390] should be null when no session worked on the PR branch', async () => {
        const item = createRepoItem();
        trackBranch(item.prNumber, 'feat/a');

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.projectSlug).toBeNull();
      });

      it('[FR-INBOX-390] should be null for an item outside every workspace repo', async () => {
        createItem();

        const [listed] = await caller.inbox.list({ tab: 'all' });

        expect(listed.projectSlug).toBeNull();
      });
    });

    it('[FR-INBOX-340] should return the latest event and recent events newest first', async () => {
      const item = createItem();
      addEvent({
        itemId: item.id,
        kind: 'approved',
        summary: 'approved it',
        actor: 'mona',
        at: '2026-03-01T11:00:00.000Z',
        sourceKey: 'second',
      });

      const [row] = await caller.inbox.list({ tab: 'all' });

      expect(row.latestEvent).toEqual({
        kind: 'approved',
        summary: 'approved it',
        actor: 'mona',
        at: '2026-03-01T11:00:00.000Z',
      });
      expect(row.events.map((e) => e.summary)).toEqual(['approved it', `comment on ${prSeq}`]);
    });

    it('[FR-INBOX-340] should cap recent events at 20', async () => {
      const item = createItem();
      for (let i = 0; i < 25; i += 1) {
        addEvent({
          itemId: item.id,
          kind: 'commented',
          summary: `c${i}`,
          at: `2026-03-02T10:00:${String(i).padStart(2, '0')}.000Z`,
          sourceKey: `many-${i}`,
        });
      }

      const [row] = await caller.inbox.list({ tab: 'all' });

      expect(row.events).toHaveLength(20);
    });

    it('[FR-INBOX-340] should only return priority items on the priority tab', async () => {
      createItem();
      const priority = createItem({ priority: true });

      const rows = await caller.inbox.list({ tab: 'priority' });

      expect(rows.map((r) => r.id)).toEqual([priority.id]);
    });

    it('[FR-INBOX-345] should wake due snoozes before listing', async () => {
      const item = createItem();
      await caller.inbox.markRead({ id: item.id });
      await caller.inbox.snooze({ id: item.id, until: new Date(Date.now() - 1000).toISOString() });

      const [row] = await caller.inbox.list({ tab: 'all' });

      expect(row.snoozedUntil).toBeNull();
      expect(row.unread).toBe(true);
    });
  });

  describe('counts', () => {
    it('[FR-INBOX-345] should wake due snoozes before counting', async () => {
      const item = createItem({ priority: true });
      await caller.inbox.markRead({ id: item.id });
      await caller.inbox.snooze({ id: item.id, until: new Date(Date.now() - 1000).toISOString() });

      const counts = await caller.inbox.counts();

      expect(counts.unreadPriority).toBe(1);
    });
  });

  describe('[FR-INBOX-350] markRead / markUnread', () => {
    it('should toggle unread state locally', async () => {
      const item = createItem();

      await caller.inbox.markRead({ id: item.id });
      expect((await caller.inbox.list({ tab: 'all' }))[0].unread).toBe(false);

      await caller.inbox.markUnread({ id: item.id });
      expect((await caller.inbox.list({ tab: 'all' }))[0].unread).toBe(true);
    });

    it('should reject an unknown item', async () => {
      await expect(caller.inbox.markRead({ id: 999 })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should PATCH the GitHub thread when the item has one', async () => {
      const item = createItem({ githubThreadId: '42' });

      await caller.inbox.markRead({ id: item.id });

      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      expect(stub.requests[0]).toMatchObject({ method: 'PATCH', url: '/notifications/threads/42' });
    });

    it('should not call GitHub when the item has no thread', async () => {
      const item = createItem();

      await caller.inbox.markRead({ id: item.id });

      expect(stub.requests).toHaveLength(0);
    });

    it('should keep local state, log once and not throw when write-back fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      stub.reply(() => ({ status: 500, body: { message: `boom ${TOKEN}` } }));
      const item = createItem({ githubThreadId: '42' });

      await expect(caller.inbox.markRead({ id: item.id })).resolves.toBeUndefined();

      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      expect(String(error.mock.calls[0][0])).not.toContain(TOKEN);
      expect((await caller.inbox.list({ tab: 'all' }))[0].unread).toBe(false);
    });
  });

  describe('[FR-INBOX-360] markAllRead', () => {
    it('should mark visible items read and write back only unread items with threads', async () => {
      createItem({ githubThreadId: '1' });
      createItem();
      const alreadyRead = createItem({ githubThreadId: '3' });
      await caller.inbox.markRead({ id: alreadyRead.id });
      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      stub.requests.length = 0;

      const result = await caller.inbox.markAllRead({ tab: 'all' });

      expect(result).toEqual({ count: 2 });
      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      expect(stub.requests[0]).toMatchObject({ method: 'PATCH', url: '/notifications/threads/1' });
      const rows = await caller.inbox.list({ tab: 'all' });
      expect(rows.every((r) => !r.unread)).toBe(true);
    });
  });

  describe('[FR-INBOX-360] markAllRead with ids', () => {
    it('should mark only the given items read, within the filter', async () => {
      const first = createItem();
      const second = createItem();
      const third = createItem();

      const result = await caller.inbox.markAllRead({
        tab: 'all',
        ids: [first.id, third.id],
      });

      expect(result).toEqual({ count: 2 });
      const rows = await caller.inbox.list({ tab: 'all' });
      expect(rows.find((r) => r.id === second.id)?.unread).toBe(true);
      expect(rows.filter((r) => !r.unread)).toHaveLength(2);
    });

    it('should mark a snoozed item read when it is in ids and includeSnoozed is set', async () => {
      const item = createItem();
      await caller.inbox.snooze({ id: item.id, until: '2999-01-01T00:00:00.000Z' });

      const result = await caller.inbox.markAllRead({
        tab: 'all',
        includeSnoozed: true,
        ids: [item.id],
      });

      expect(result).toEqual({ count: 1 });
    });

    it('should ignore ids outside the workspace filter', async () => {
      const item = createItem();

      const result = await caller.inbox.markAllRead({
        tab: 'all',
        workspaceId: 99,
        ids: [item.id],
      });

      expect(result).toEqual({ count: 0 });
    });

    it('should change nothing for an empty ids list', async () => {
      createItem();

      const result = await caller.inbox.markAllRead({ tab: 'all', ids: [] });

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('[FR-INBOX-370] markDone', () => {
    it('should hide the item and DELETE the GitHub thread', async () => {
      const item = createItem({ githubThreadId: '42' });

      await caller.inbox.markDone({ id: item.id });

      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(0);
      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      expect(stub.requests[0]).toMatchObject({
        method: 'DELETE',
        url: '/notifications/threads/42',
      });
    });
  });

  describe('markAllDone', () => {
    it('[FR-INBOX-510] should mark done every item of the filter and DELETE their threads', async () => {
      createItem({ githubThreadId: '1', priority: true });
      createItem({ githubThreadId: '2' });

      const result = await caller.inbox.markAllDone({ tab: 'priority' });

      expect(result).toEqual({ count: 1, githubFailures: 0 });
      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(1);
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]).toMatchObject({
        method: 'DELETE',
        url: '/notifications/threads/1',
      });
    });

    it('[FR-INBOX-510] should keep unread items when onlyRead is set', async () => {
      const read = createItem();
      createItem();
      await caller.inbox.markRead({ id: read.id });

      const result = await caller.inbox.markAllDone({ tab: 'all', onlyRead: true });

      expect(result.count).toBe(1);
      const rest = await caller.inbox.list({ tab: 'all' });
      expect(rest).toHaveLength(1);
      expect(rest[0].unread).toBe(true);
    });

    it('[FR-INBOX-510] should limit the change to the workspace filter', async () => {
      createItem();

      const result = await caller.inbox.markAllDone({ tab: 'all', workspaceId: 99 });

      expect(result.count).toBe(0);
      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(1);
    });

    it('[FR-INBOX-510] should clear only the given ids, within the filter', async () => {
      const shown = createItem({ githubThreadId: '1' });
      createItem({ githubThreadId: '2' });

      const result = await caller.inbox.markAllDone({ tab: 'all', ids: [shown.id] });

      expect(result).toEqual({ count: 1, githubFailures: 0 });
      const rest = await caller.inbox.list({ tab: 'all' });
      expect(rest).toHaveLength(1);
      expect(rest[0].id).not.toBe(shown.id);
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]).toMatchObject({ url: '/notifications/threads/1' });
    });

    it('[FR-INBOX-510] should ignore ids outside the tab filter', async () => {
      const other = createItem();

      const result = await caller.inbox.markAllDone({ tab: 'priority', ids: [other.id] });

      expect(result.count).toBe(0);
      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(1);
    });

    it('[FR-INBOX-520] should finish the local change, count GitHub failures and broadcast once', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const spy = vi.spyOn(broadcast, 'broadcastInboxChange').mockImplementation(() => undefined);
      stub.reply(() => ({ status: 500, body: { message: 'boom' } }));
      createItem({ githubThreadId: '1' });
      createItem({ githubThreadId: '2' });
      createItem();
      spy.mockClear();

      const result = await caller.inbox.markAllDone({ tab: 'all' });

      expect(result).toEqual({ count: 3, githubFailures: 2 });
      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(0);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('[FR-INBOX-520] should not broadcast when nothing matches', async () => {
      const spy = vi.spyOn(broadcast, 'broadcastInboxChange').mockImplementation(() => undefined);

      const result = await caller.inbox.markAllDone({ tab: 'all' });

      expect(result).toEqual({ count: 0, githubFailures: 0 });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('[FR-INBOX-380] snooze', () => {
    it('should hide the item until it is included explicitly', async () => {
      const item = createItem();

      await caller.inbox.snooze({
        id: item.id,
        until: new Date(Date.now() + 3600_000).toISOString(),
      });

      expect(await caller.inbox.list({ tab: 'all' })).toHaveLength(0);
      expect(await caller.inbox.list({ tab: 'all', includeSnoozed: true })).toHaveLength(1);
    });

    it('should reject an invalid date', async () => {
      const item = createItem();

      await expect(caller.inbox.snooze({ id: item.id, until: 'tomorrow' })).rejects.toThrow();
    });
  });

  describe('[FR-INBOX-630] replies', () => {
    function replyPr(repo: string, number: number) {
      return {
        number,
        title: `PR ${number}`,
        url: `https://github.com/${repo}/pull/${number}`,
        author: { login: 'me' },
        repository: { nameWithOwner: repo },
        comments: {
          nodes: [
            {
              databaseId: number * 10,
              body: 'looks good',
              url: `https://github.com/${repo}/pull/${number}#c1`,
              createdAt: '2026-03-01T10:00:00Z',
              author: { login: 'alice' },
            },
          ],
        },
        reviewThreads: { nodes: [] },
      };
    }

    function stubGithub(scopes = 'repo, notifications') {
      stub.reply((req) => {
        if (req.url === '/user') {
          return { headers: { 'x-oauth-scopes': scopes }, body: { login: 'me' } };
        }
        return {
          body: {
            data: { search: { nodes: [replyPr('acme/api', 1), replyPr('acme/web', 2)] } },
          },
        };
      });
    }

    function seedWorkspace(slug: string, repoPath: string, repoFullName: string): number {
      ctx.state.repoFullNames.set(repoPath, repoFullName);
      return ctx.db
        .insert(workspaces)
        .values({ name: slug, slug, repos: [repoPath] })
        .returning()
        .get().id;
    }

    it('should return the replies with the workspace of their repo', async () => {
      stubGithub();
      const workspaceId = seedWorkspace('api', '/repos/api', 'acme/api');

      const replies = await caller.inbox.replies({});

      expect(replies).toEqual([
        expect.objectContaining({ repoFullName: 'acme/api', prNumber: 1, workspaceId }),
        expect.objectContaining({ repoFullName: 'acme/web', prNumber: 2, workspaceId: null }),
      ]);
    });

    it('should keep only the replies of the given workspace', async () => {
      stubGithub();
      seedWorkspace('api', '/repos/api', 'acme/api');
      const webId = seedWorkspace('web', '/repos/web', 'Acme/Web');

      const replies = await caller.inbox.replies({ workspaceId: webId });

      expect(replies.map((reply) => reply.prNumber)).toEqual([2]);
    });

    it('should fail with the GitHub status message when GitHub is unavailable', async () => {
      delete process.env.ENGY_GITHUB_TOKEN;

      await expect(caller.inbox.replies({})).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining('ENGY_GITHUB_TOKEN'),
      });
    });
  });
});
