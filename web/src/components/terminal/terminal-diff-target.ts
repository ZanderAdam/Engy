interface WorktreeRepoEntry {
  repoPath: string;
  worktreePath: string;
}

interface WorktreeBranchGroup {
  branch: string;
  repos: WorktreeRepoEntry[];
}

interface DiffTarget {
  repoDir: string;
  /** Set only for a materialized project worktree, which `?wt` selects by branch. */
  worktreeBranch: string | null;
}

/**
 * Which repo the Diffs page should open for a terminal's working directory.
 *
 * A worktree terminal runs in the worktree, not the repo the Diffs page selects
 * from, so the worktree list is checked first and maps back to its repo. Any
 * other directory belongs to the repo that contains it — an agent that `cd`ed
 * into a subdirectory still reviews the whole repo.
 */
export function resolveDiffTarget(
  workingDir: string,
  worktreeGroups: WorktreeBranchGroup[],
  repos: string[],
): DiffTarget | null {
  for (const group of worktreeGroups) {
    const entry = group.repos.find((repo) => repo.worktreePath === workingDir);
    if (entry) return { repoDir: entry.repoPath, worktreeBranch: group.branch };
  }

  const containing = repos
    .filter((repo) => workingDir === repo || workingDir.startsWith(`${repo}/`))
    .sort((a, b) => b.length - a.length)[0];

  return containing ? { repoDir: containing, worktreeBranch: null } : null;
}

export function branchDiffHref(args: {
  workspaceSlug: string;
  projectSlug: string;
  target: DiffTarget;
}): string {
  const params = new URLSearchParams({ diffView: 'branch', diffRepo: args.target.repoDir });
  if (args.target.worktreeBranch) params.set('wt', args.target.worktreeBranch);
  return `/w/${args.workspaceSlug}/projects/${args.projectSlug}/diffs?${params.toString()}`;
}
