import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../db/client';
import { reviewWorktrees } from '../db/schema';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { resolveReviewScope } from './review-scope';

const WORKTREE = '/home/dev/.engy/ws/worktrees/_review/proj/pr-7';

describe('resolveReviewScope', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    getDb()
      .insert(reviewWorktrees)
      .values({
        repoPath: '/home/dev/proj',
        repoFullName: 'acme/proj',
        prNumber: 7,
        worktreePath: WORKTREE,
        headRefName: 'feature/tokens',
        headSha: 'abc',
        createdByReview: true,
      })
      .run();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should return the main checkout and PR head branch for the worktree root', () => {
    expect(resolveReviewScope(getDb(), WORKTREE)).toEqual({
      repoDir: '/home/dev/proj',
      branch: 'feature/tokens',
    });
  });

  it('should match a directory inside the worktree', () => {
    expect(resolveReviewScope(getDb(), `${WORKTREE}/src/lib`)?.branch).toBe('feature/tokens');
  });

  it('should not match a sibling directory sharing the path prefix', () => {
    expect(resolveReviewScope(getDb(), `${WORKTREE}-other`)).toBeNull();
  });

  it('should return null outside any review worktree', () => {
    expect(resolveReviewScope(getDb(), '/home/dev/proj')).toBeNull();
  });
});
