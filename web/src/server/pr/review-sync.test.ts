import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { prs as prsTable, commentThreads, threadComments } from '../db/schema';
import { syncReviewComments } from './review-sync';
import type { GhReviewComment } from '@engy/common';

function makePrRow(overrides: Partial<typeof prsTable.$inferSelect> = {}): typeof prsTable.$inferSelect {
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
    lastFailedHeadSha: null,
    autoFixAttempts: 0,
    autoFixTotalAttempts: 0,
    attentionReason: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeComment(overrides: Partial<GhReviewComment> = {}): GhReviewComment {
  return {
    githubId: 1001,
    path: 'src/foo.ts',
    line: 10,
    body: 'This looks off',
    author: 'bob',
    createdAt: '2024-01-02T00:00:00.000Z',
    inReplyToId: null,
    url: 'https://github.com/org/repo/pull/42#discussion_r1001',
    ...overrides,
  };
}

describe('[FR-PRMON-160] syncReviewComments', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('top-level comments', () => {
    it('should create a thread and comment for a top-level review comment', () => {
      const prRow = makePrRow();
      const comment = makeComment({ githubId: 1001, path: 'src/foo.ts', line: 10 });

      syncReviewComments(ctx.db, prRow, [comment]);

      const thread = ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, 'gh-thread-1001'))
        .get();
      expect(thread).toBeTruthy();
      expect(thread!.documentPath).toBe('diff:///home/user/repo/src/foo.ts');
      const meta = thread!.metadata as Record<string, unknown>;
      expect(meta.source).toBe('github');
      expect(meta.githubId).toBe(1001);
      expect(meta.prNumber).toBe(42);
      expect(meta.lineNumber).toBe(10);
      expect(meta.author).toBe('bob');

      const cmt = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, 'gh-comment-1001'))
        .get();
      expect(cmt).toBeTruthy();
      expect(cmt!.body).toBe('This looks off');
      expect(cmt!.userId).toBe('bob');
    });

    it('should use lineNumber 0 when line is null', () => {
      const prRow = makePrRow();
      const comment = makeComment({ githubId: 2001, line: null });

      syncReviewComments(ctx.db, prRow, [comment]);

      const thread = ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, 'gh-thread-2001'))
        .get();
      const meta = thread!.metadata as Record<string, unknown>;
      expect(meta.line).toBeNull();
      expect(meta.lineNumber).toBe(0);
    });

    it('should be idempotent — re-import does not duplicate threads or comments', () => {
      const prRow = makePrRow();
      const comment = makeComment({ githubId: 3001 });

      syncReviewComments(ctx.db, prRow, [comment]);
      syncReviewComments(ctx.db, prRow, [comment]);

      const threads = ctx.db.select().from(commentThreads).all();
      expect(threads).toHaveLength(1);
      const comments = ctx.db.select().from(threadComments).all();
      expect(comments).toHaveLength(1);
    });

    it('should update comment body when it changed on GitHub', () => {
      const prRow = makePrRow();
      const original = makeComment({ githubId: 4001, body: 'Original comment' });
      syncReviewComments(ctx.db, prRow, [original]);

      const updated = makeComment({ githubId: 4001, body: 'Updated comment' });
      syncReviewComments(ctx.db, prRow, [updated]);

      const cmt = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, 'gh-comment-4001'))
        .get();
      expect(cmt!.body).toBe('Updated comment');
    });

    it('should NOT auto-unresolve a locally resolved thread on re-import', () => {
      const prRow = makePrRow();
      const comment = makeComment({ githubId: 5001 });
      syncReviewComments(ctx.db, prRow, [comment]);

      ctx.db
        .update(commentThreads)
        .set({ resolved: true, resolvedBy: 'local-user', resolvedAt: new Date().toISOString() })
        .where(eq(commentThreads.id, 'gh-thread-5001'))
        .run();

      syncReviewComments(ctx.db, prRow, [comment]);

      const thread = ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, 'gh-thread-5001'))
        .get();
      expect(thread!.resolved).toBe(true);
    });

    it('should leave local rows when comment is missing from re-import (deleted on GitHub)', () => {
      const prRow = makePrRow();
      const comment = makeComment({ githubId: 6001 });
      syncReviewComments(ctx.db, prRow, [comment]);

      // Re-import with empty list (comment deleted on GitHub)
      syncReviewComments(ctx.db, prRow, []);

      const thread = ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, 'gh-thread-6001'))
        .get();
      expect(thread).toBeTruthy();

      const cmt = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, 'gh-comment-6001'))
        .get();
      expect(cmt).toBeTruthy();
    });

    it('should create a thread per unique file path', () => {
      const prRow = makePrRow();
      const c1 = makeComment({ githubId: 7001, path: 'src/a.ts' });
      const c2 = makeComment({ githubId: 7002, path: 'src/b.ts' });

      syncReviewComments(ctx.db, prRow, [c1, c2]);

      const threads = ctx.db.select().from(commentThreads).all();
      expect(threads).toHaveLength(2);
      const paths = threads.map((t) => t.documentPath).sort();
      expect(paths).toEqual([
        'diff:///home/user/repo/src/a.ts',
        'diff:///home/user/repo/src/b.ts',
      ]);
    });
  });

  describe('reply comments', () => {
    it('should add a reply as a threadComments row on the parent thread', () => {
      const prRow = makePrRow();
      const parent = makeComment({ githubId: 8001, inReplyToId: null });
      const reply = makeComment({
        githubId: 8002,
        inReplyToId: 8001,
        body: 'Good point!',
        author: 'carol',
      });

      syncReviewComments(ctx.db, prRow, [parent, reply]);

      const comments = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.threadId, 'gh-thread-8001'))
        .all();
      expect(comments).toHaveLength(2);
      const reply_ = comments.find((c) => c.id === 'gh-comment-8002');
      expect(reply_!.body).toBe('Good point!');
      expect(reply_!.userId).toBe('carol');
    });

    it('should skip a reply whose parent thread does not exist', () => {
      const prRow = makePrRow();
      const orphanReply = makeComment({ githubId: 9001, inReplyToId: 9999 });

      syncReviewComments(ctx.db, prRow, [orphanReply]);

      const threads = ctx.db.select().from(commentThreads).all();
      expect(threads).toHaveLength(0);
      const comments = ctx.db.select().from(threadComments).all();
      expect(comments).toHaveLength(0);
    });

    it('should be idempotent for replies — no duplicate threadComments', () => {
      const prRow = makePrRow();
      const parent = makeComment({ githubId: 10001 });
      const reply = makeComment({ githubId: 10002, inReplyToId: 10001, body: 'Reply body' });

      syncReviewComments(ctx.db, prRow, [parent, reply]);
      syncReviewComments(ctx.db, prRow, [parent, reply]);

      const comments = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.threadId, 'gh-thread-10001'))
        .all();
      expect(comments).toHaveLength(2);
    });

    it('should update reply body when it changed on GitHub', () => {
      const prRow = makePrRow();
      const parent = makeComment({ githubId: 11001 });
      const reply = makeComment({ githubId: 11002, inReplyToId: 11001, body: 'Before edit' });
      syncReviewComments(ctx.db, prRow, [parent, reply]);

      const updatedReply = makeComment({ githubId: 11002, inReplyToId: 11001, body: 'After edit' });
      syncReviewComments(ctx.db, prRow, [parent, updatedReply]);

      const cmt = ctx.db
        .select()
        .from(threadComments)
        .where(eq(threadComments.id, 'gh-comment-11002'))
        .get();
      expect(cmt!.body).toBe('After edit');
    });
  });

  describe('documentPath format', () => {
    it('should produce diff:// URI matching the diff viewer expectation', () => {
      const prRow = makePrRow({ repo: '/Users/dev/my-project' });
      const comment = makeComment({ githubId: 12001, path: 'packages/core/src/index.ts' });

      syncReviewComments(ctx.db, prRow, [comment]);

      const thread = ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, 'gh-thread-12001'))
        .get();
      expect(thread!.documentPath).toBe(
        'diff:///Users/dev/my-project/packages/core/src/index.ts',
      );
    });
  });
});
