import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, type TestContext } from '../test-helpers';
import { appRouter } from '../root';
import { addEvent, upsertItem } from '../../inbox/store';
import { NO_BUCKET_FACTS } from '../../inbox/bucket';
import { commentThreads, reviewWorktrees } from '../../db/schema';
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

    it('should return the latest event and recent events newest first', async () => {
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

    it('should cap recent events at 20', async () => {
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

    it('should only return priority items on the priority tab', async () => {
      createItem();
      const priority = createItem({ priority: true });

      const rows = await caller.inbox.list({ tab: 'priority' });

      expect(rows.map((r) => r.id)).toEqual([priority.id]);
    });

    it('should wake due snoozes before listing', async () => {
      const item = createItem();
      await caller.inbox.markRead({ id: item.id });
      await caller.inbox.snooze({ id: item.id, until: new Date(Date.now() - 1000).toISOString() });

      const [row] = await caller.inbox.list({ tab: 'all' });

      expect(row.snoozedUntil).toBeNull();
      expect(row.unread).toBe(true);
    });
  });

  describe('counts', () => {
    it('should wake due snoozes before counting', async () => {
      const item = createItem({ priority: true });
      await caller.inbox.markRead({ id: item.id });
      await caller.inbox.snooze({ id: item.id, until: new Date(Date.now() - 1000).toISOString() });

      const counts = await caller.inbox.counts();

      expect(counts.unreadPriority).toBe(1);
    });
  });

  describe('markRead / markUnread', () => {
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

  describe('markAllRead', () => {
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

  describe('markDone', () => {
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

  describe('snooze', () => {
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
});
