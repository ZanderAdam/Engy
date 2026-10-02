import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { prs as prsTable, commentThreads, threadComments } from '../db/schema';
import { syncReviewThreads } from './review-sync';
import type { GithubReviewThread, GithubReviewThreadComment } from '../github/review-threads';

function makePrRow(
  overrides: Partial<typeof prsTable.$inferSelect> = {},
): typeof prsTable.$inferSelect {
  return {
    id: 1,
    repo: '/home/user/repo',
    number: 42,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/42',
    headBranch: 'feat/thing',
    headSha: 'abc123',
    author: 'alice',
    isDraft: false,
    ciStatus: 'passing',
    checks: [],
    commentCount: 0,
    authoredByViewer: false,
    reviewDecision: null,
    repoFullName: 'org/repo',
    baseRef: 'main',
    additions: 0,
    deletions: 0,
    reviewRequests: [],
    lastFailedHeadSha: null,
    autoFixAttempts: 0,
    autoFixTotalAttempts: 0,
    attentionReason: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeComment(
  githubId: number,
  overrides: Partial<GithubReviewThreadComment> = {},
): GithubReviewThreadComment {
  return {
    githubId,
    body: 'This looks off',
    author: 'bob',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    url: `https://github.com/org/repo/pull/42#discussion_r${githubId}`,
    replyToId: null,
    ...overrides,
  };
}

function makeThread(
  rootId: number,
  overrides: Partial<GithubReviewThread> = {},
): GithubReviewThread {
  return {
    nodeId: `PRRT_${rootId}`,
    isResolved: false,
    isOutdated: false,
    path: 'src/foo.ts',
    line: 10,
    originalLine: 10,
    startLine: null,
    diffSide: 'RIGHT',
    comments: [makeComment(rootId)],
    ...overrides,
  };
}

describe('[FR-PRMON-160] syncReviewThreads', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function getThread(id: string) {
    return ctx.db.select().from(commentThreads).where(eq(commentThreads.id, id)).get();
  }

  function getComments(threadId: string) {
    return ctx.db.select().from(threadComments).where(eq(threadComments.threadId, threadId)).all();
  }

  describe('thread import', () => {
    it('should create a thread keyed by the first comment id with GitHub metadata', () => {
      syncReviewThreads(ctx.db, makePrRow(), [
        makeThread(1001, { isOutdated: true, originalLine: 8 }),
      ]);

      const thread = getThread('gh-thread-1001');
      expect(thread!.documentPath).toBe('diff:///home/user/repo#feat%2Fthing/src/foo.ts');
      expect(thread!.metadata).toMatchObject({
        source: 'github',
        githubId: 1001,
        githubThreadNodeId: 'PRRT_1001',
        prNumber: 42,
        line: 10,
        originalLine: 8,
        lineNumber: 0,
        diffSide: 'RIGHT',
        isOutdated: true,
        author: 'bob',
      });
      const comment = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, 'gh-comment-1001'))
        .get();
      expect(comment).toMatchObject({
        threadId: 'gh-thread-1001',
        body: 'This looks off',
        userId: 'bob',
      });
    });

    it('should not anchor an outdated thread onto the current diff', () => {
      syncReviewThreads(ctx.db, makePrRow(), [
        makeThread(2001, { line: null, originalLine: 7, isOutdated: true }),
        makeThread(2003, { line: 12, originalLine: 7, isOutdated: true }),
      ]);

      const meta = getThread('gh-thread-2001')!.metadata as Record<string, unknown>;
      expect(meta.line).toBeNull();
      expect(meta.originalLine).toBe(7);
      expect(meta.lineNumber).toBe(0);
      expect(meta.isOutdated).toBe(true);
      expect((getThread('gh-thread-2003')!.metadata as Record<string, unknown>).lineNumber).toBe(0);
    });

    it('should store the local side so a comment on a deleted line stays on the original side', () => {
      syncReviewThreads(ctx.db, makePrRow(), [
        makeThread(2101, { diffSide: 'LEFT', line: 4 }),
        makeThread(2102, { diffSide: 'RIGHT', line: 5 }),
      ]);

      expect(getThread('gh-thread-2101')!.metadata).toMatchObject({
        side: 'original',
        diffSide: 'LEFT',
      });
      expect(getThread('gh-thread-2102')!.metadata).toMatchObject({
        side: 'modified',
        diffSide: 'RIGHT',
      });
    });

    it('should add the local side to a row imported before the side was stored', () => {
      ctx.db
        .insert(commentThreads)
        .values({
          id: 'gh-thread-2201',
          workspaceId: null,
          documentPath: 'diff:///home/user/repo#feat%2Fthing/src/foo.ts',
          metadata: {
            source: 'github',
            prNumber: 42,
            githubId: 2201,
            line: 4,
            lineNumber: 4,
            diffSide: 'LEFT',
          },
        })
        .run();

      syncReviewThreads(ctx.db, makePrRow(), [makeThread(2201, { diffSide: 'LEFT', line: 4 })]);

      expect(getThread('gh-thread-2201')!.metadata).toMatchObject({ side: 'original' });
    });

    it('should use lineNumber 0 when no line is known', () => {
      syncReviewThreads(ctx.db, makePrRow(), [
        makeThread(2002, { line: null, originalLine: null }),
      ]);

      expect((getThread('gh-thread-2002')!.metadata as Record<string, unknown>).lineNumber).toBe(0);
    });

    it('should be idempotent and report no changes on re-import', () => {
      const prRow = makePrRow();
      const thread = makeThread(3001, {
        comments: [makeComment(3001), makeComment(3002, { replyToId: 3001 })],
      });

      syncReviewThreads(ctx.db, prRow, [thread]);
      const second = syncReviewThreads(ctx.db, prRow, [thread]);

      expect(ctx.db.select().from(commentThreads).all()).toHaveLength(1);
      expect(ctx.db.select().from(threadComments).all()).toHaveLength(2);
      expect(second).toEqual({ created: 0, updated: 0 });
    });

    it('should keep ids compatible with rows imported from review comments', () => {
      ctx.db
        .insert(commentThreads)
        .values({
          id: 'gh-thread-4001',
          workspaceId: null,
          documentPath: 'diff:///home/user/repo#feat%2Fthing/src/foo.ts',
          metadata: { source: 'github', prNumber: 42, githubId: 4001, line: 10, lineNumber: 10 },
        })
        .run();
      ctx.db
        .insert(threadComments)
        .values({
          id: 'gh-comment-4001',
          threadId: 'gh-thread-4001',
          userId: 'bob',
          body: 'This looks off',
          metadata: { githubId: 4001 },
        })
        .run();

      syncReviewThreads(ctx.db, makePrRow(), [makeThread(4001)]);

      expect(ctx.db.select().from(commentThreads).all()).toHaveLength(1);
      expect(ctx.db.select().from(threadComments).all()).toHaveLength(1);
      expect(getThread('gh-thread-4001')!.metadata).toMatchObject({
        githubThreadNodeId: 'PRRT_4001',
        diffSide: 'RIGHT',
      });
    });

    it('should update the outdated flag on an existing thread', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(5001)]);

      syncReviewThreads(ctx.db, prRow, [makeThread(5001, { isOutdated: true, line: null })]);

      expect(getThread('gh-thread-5001')!.metadata).toMatchObject({
        isOutdated: true,
        line: null,
      });
    });

    it('should update comment body when it changed on GitHub', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(6001)]);

      const edited = makeThread(6001, { comments: [makeComment(6001, { body: 'Edited' })] });
      const summary = syncReviewThreads(ctx.db, prRow, [edited]);

      expect(getComments('gh-thread-6001')[0].body).toBe('Edited');
      expect(summary.updated).toBe(1);
    });

    it('should leave local rows when a thread is missing from re-import', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(7001)]);

      syncReviewThreads(ctx.db, prRow, []);

      expect(getThread('gh-thread-7001')).toBeTruthy();
      expect(getComments('gh-thread-7001')).toHaveLength(1);
    });

    it('should skip a thread with no comments', () => {
      syncReviewThreads(ctx.db, makePrRow(), [makeThread(8001, { comments: [] })]);

      expect(ctx.db.select().from(commentThreads).all()).toHaveLength(0);
    });
  });

  describe('replies', () => {
    it('should attach replies to the thread in GitHub order', () => {
      const thread = makeThread(9001, {
        comments: [
          makeComment(9001),
          makeComment(9002, {
            replyToId: 9001,
            body: 'Good point!',
            author: 'carol',
            createdAt: '2024-01-03T00:00:00.000Z',
          }),
          makeComment(9003, { replyToId: 9001, createdAt: '2024-01-04T00:00:00.000Z' }),
        ],
      });

      syncReviewThreads(ctx.db, makePrRow(), [thread]);

      const comments = getComments('gh-thread-9001').sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      expect(comments.map((c) => c.id)).toEqual([
        'gh-comment-9001',
        'gh-comment-9002',
        'gh-comment-9003',
      ]);
      expect(comments[1]).toMatchObject({ body: 'Good point!', userId: 'carol' });
    });

    it('should add a new reply to an existing thread', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(9101)]);

      const summary = syncReviewThreads(ctx.db, prRow, [
        makeThread(9101, { comments: [makeComment(9101), makeComment(9102, { replyToId: 9101 })] }),
      ]);

      expect(getComments('gh-thread-9101')).toHaveLength(2);
      expect(summary.created).toBe(1);
    });

    it('should update an edited reply body', () => {
      const prRow = makePrRow();
      const withReply = (body: string) =>
        makeThread(9201, {
          comments: [makeComment(9201), makeComment(9202, { replyToId: 9201, body })],
        });
      syncReviewThreads(ctx.db, prRow, [withReply('Before')]);

      syncReviewThreads(ctx.db, prRow, [withReply('After')]);

      const reply = getComments('gh-thread-9201').find((c) => c.id === 'gh-comment-9202');
      expect(reply!.body).toBe('After');
    });
  });

  describe('resolved state', () => {
    it('should import a resolved thread as resolved', () => {
      syncReviewThreads(ctx.db, makePrRow(), [makeThread(10001, { isResolved: true })]);

      const thread = getThread('gh-thread-10001');
      expect(thread!.resolved).toBe(true);
      expect(thread!.resolvedBy).toBe('github');
    });

    it('should resolve a local thread when GitHub resolves it', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(10101)]);

      syncReviewThreads(ctx.db, prRow, [makeThread(10101, { isResolved: true })]);

      expect(getThread('gh-thread-10101')!.resolved).toBe(true);
    });

    it('should unresolve a local thread when GitHub unresolves it', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(10201, { isResolved: true })]);

      syncReviewThreads(ctx.db, prRow, [makeThread(10201, { isResolved: false })]);

      const thread = getThread('gh-thread-10201');
      expect(thread!.resolved).toBe(false);
      expect(thread!.resolvedBy).toBeNull();
      expect(thread!.resolvedAt).toBeNull();
    });

    it('should keep a locally dismissed thread resolved', () => {
      const prRow = makePrRow();
      syncReviewThreads(ctx.db, prRow, [makeThread(10301)]);
      const existing = getThread('gh-thread-10301')!;
      ctx.db
        .update(commentThreads)
        .set({
          resolved: true,
          resolvedBy: 'local-user',
          metadata: { ...existing.metadata, localDismissed: true },
        })
        .where(eq(commentThreads.id, 'gh-thread-10301'))
        .run();

      syncReviewThreads(ctx.db, prRow, [makeThread(10301, { isResolved: false })]);

      const thread = getThread('gh-thread-10301');
      expect(thread!.resolved).toBe(true);
      expect(thread!.resolvedBy).toBe('local-user');
      expect((thread!.metadata as Record<string, unknown>).localDismissed).toBe(true);
    });
  });

  describe('documentPath format', () => {
    it('should key the thread on the pull request head branch, as the diff viewer reads it', () => {
      const prRow = makePrRow({ repo: '/Users/dev/my-project', headBranch: 'fix/index' });

      syncReviewThreads(ctx.db, prRow, [makeThread(12001, { path: 'packages/core/src/index.ts' })]);

      expect(getThread('gh-thread-12001')!.documentPath).toBe(
        'diff:///Users/dev/my-project#fix%2Findex/packages/core/src/index.ts',
      );
    });
  });
});
