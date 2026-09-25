'use client';

import { trpc } from '@/lib/trpc';
import type { TerminalScope } from './types';

interface SessionBranch {
  branch: string | null;
  /** Repo git says owns the directory, or null when it owns none. */
  repoRoot: string | null;
}

/**
 * The branch a terminal session is on right now.
 *
 * `scope.worktreeBranch` is only a snapshot taken when the session was created,
 * so a restored session reports whatever was true then. Git answers for the
 * directory the session is actually in, and follows the agent into a worktree.
 * The snapshot stands in until the answer arrives, so the subtitle never blinks.
 */
export function useSessionBranch(scope: TerminalScope): SessionBranch {
  const dir = scope.agentCwd ?? scope.workingDir;
  const { data } = trpc.diff.getBranch.useQuery(
    { repoDir: dir },
    { enabled: !!dir, retry: false, staleTime: 30_000, refetchOnWindowFocus: true },
  );
  return {
    branch: data?.branch ?? scope.worktreeBranch ?? null,
    repoRoot: data?.repoRoot ?? null,
  };
}
