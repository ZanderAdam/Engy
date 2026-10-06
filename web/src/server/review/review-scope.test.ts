import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../db/client';
import { reviewWorktrees } from '../db/schema';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { resolveReviewScope } from './review-scope';

const WORKTREE = '/home/dev/.engy/ws/worktrees/_review/proj/pr-7';

describe('[FR-PRREVIEW-150] resolveReviewScope', () => {
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

  it('[FR-PRREVIEW-150] should ignore a reused agent worktree the review did not create', () => {
    const agentWorktree = '/home/dev/proj-agent-wt';
    getDb()
      .insert(reviewWorktrees)
      .values({
        repoPath: '/home/dev/proj',
        repoFullName: 'acme/proj',
        prNumber: 8,
        worktreePath: agentWorktree,
        headRefName: 'feature/other',
        headSha: 'def',
        createdByReview: false,
      })
      .run();

    expect(resolveReviewScope(getDb(), agentWorktree)).toBeNull();
  });

  it('[FR-PRREVIEW-151] should scope a cross-repo PR worktree to its own pull ref key', () => {
    const forkWorktree = '/home/dev/.engy/ws/worktrees/_review/proj/pr-9';
    getDb()
      .insert(reviewWorktrees)
      .values({
        repoPath: '/home/dev/proj',
        repoFullName: 'acme/proj',
        prNumber: 9,
        worktreePath: forkWorktree,
        headRefName: 'main',
        headSha: 'fed',
        createdByReview: true,
        isCrossRepository: true,
      })
      .run();

    expect(resolveReviewScope(getDb(), forkWorktree)?.branch).toBe('pull/9/head');
  });

  it('should return null outside any review worktree', () => {
    expect(resolveReviewScope(getDb(), '/home/dev/proj')).toBeNull();
  });
});
