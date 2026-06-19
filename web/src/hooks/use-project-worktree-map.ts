'use client';

import { useMemo } from 'react';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';

interface WorktreeRepoEntry {
  repoPath: string;
  worktreePath: string;
}

interface WorktreeGroup {
  branch: string;
  repos: WorktreeRepoEntry[];
}

interface ProjectWorktreeMap {
  /** The active branch from `?wt`, or null when absent or unknown. */
  branch: string | null;
  /** repoPath → worktreePath for the active branch. Empty when branch is null. */
  repoMap: Map<string, string>;
  /** All branch groups returned by the server. */
  allGroups: WorktreeGroup[];
  /** Whether the underlying query is still loading. */
  isLoading: boolean;
}

/**
 * Reads `?wt=<branch>` from the virtual URL and looks up the matching worktree
 * group from `trpc.worktree.listGrouped`. Returns the per-repo path map for
 * downstream consumers (terminals, diffs, code, docs).
 *
 * If `?wt` is absent or points at a branch that's not (anymore) materialized,
 * `branch` is null and `repoMap` is empty.
 */
export function useProjectWorktreeMap(args: {
  projectId: number | undefined;
  /**
   * Combined-worktree mode: `?wt` no longer rebases content to a worktree, so
   * `branch`/`repoMap` collapse to the default branch. `allGroups` is still
   * returned (the new-terminal menu and manage dialog need it).
   */
  combined?: boolean;
}): ProjectWorktreeMap {
  const searchParams = useVirtualSearchParams();
  const wtParam = searchParams.get('wt');

  const { data, isLoading } = trpc.worktree.listGrouped.useQuery(
    { projectId: args.projectId ?? 0 },
    { enabled: !!args.projectId },
  );

  const allGroups: WorktreeGroup[] = data?.groups ?? [];
  const combined = args.combined ?? false;

  return useMemo(() => {
    if (combined || !wtParam) {
      return { branch: null, repoMap: new Map(), allGroups, isLoading };
    }
    const group = allGroups.find((g) => g.branch === wtParam);
    if (!group) {
      // Stale `?wt` — treat as no selection (FR11).
      return { branch: null, repoMap: new Map(), allGroups, isLoading };
    }
    const repoMap = new Map<string, string>();
    for (const r of group.repos) repoMap.set(r.repoPath, r.worktreePath);
    return { branch: group.branch, repoMap, allGroups, isLoading };
  }, [combined, wtParam, allGroups, isLoading]);
}
