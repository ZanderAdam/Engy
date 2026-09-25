import type { TaggedWorktreeEntry } from '@/server/trpc/routers/diff';
import type { WorktreeSelection } from './worktree-selector';

/**
 * The worktree a `?diffBranch` link asks for, as the worktree dropdown would
 * resolve it. `undefined` means the link has no opinion — no branch was asked
 * for, or git has not listed the worktrees yet — so the reader's own choice
 * stands instead of flashing to the main repo.
 */
export function worktreeForBranch(
  worktrees: TaggedWorktreeEntry[] | undefined,
  branch: string | null,
): WorktreeSelection | undefined {
  if (!branch || !worktrees) return undefined;
  const entry = worktrees.find((wt) => wt.branch === branch);
  if (!entry) return undefined;
  if (entry.isMain) return null;
  return entry.location === 'local'
    ? { worktreePath: entry.path }
    : { worktreePath: entry.path, coderWorkspace: entry.location.coderWorkspace };
}
