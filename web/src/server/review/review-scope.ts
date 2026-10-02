import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { reviewWorktrees } from '../db/schema';
import { isPathInside } from '../lib/path-inside';

interface ReviewScope {
  repoDir: string;
  branch: string;
}

export function resolveReviewScope(db: Db, dir: string): ReviewScope | null {
  const row = db
    .select()
    .from(reviewWorktrees)
    .where(eq(reviewWorktrees.createdByReview, true))
    .all()
    .find((candidate) => isPathInside(candidate.worktreePath, dir));
  return row ? { repoDir: row.repoPath, branch: row.headRefName } : null;
}
