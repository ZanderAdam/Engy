import path from 'node:path';
import type { Db } from '../db/client';
import { reviewWorktrees } from '../db/schema';

interface ReviewScope {
  repoDir: string;
  branch: string;
}

function isInside(dir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveReviewScope(db: Db, dir: string): ReviewScope | null {
  const row = db
    .select()
    .from(reviewWorktrees)
    .all()
    .find((candidate) => isInside(candidate.worktreePath, dir));
  return row ? { repoDir: row.repoPath, branch: row.headRefName } : null;
}
