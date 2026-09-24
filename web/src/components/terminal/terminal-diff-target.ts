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
  /** Branch the Diffs page should switch to, via `?wt`. */
  worktreeBranch: string | null;
}

interface DiffSession {
  /** Where the terminal runs — for a project scope this is the project's docs
   *  directory, not the repo, so it can only narrow the repo, never name it. */
  workingDir: string;
  /** The worktree the session targets. Set by the scope, kept current as the
   *  agent moves; this is what names the worktree, not the path. */
  worktreeBranch?: string;
}

function containingRepo(workingDir: string, repos: string[]): string | null {
  return (
    repos
      .filter((repo) => workingDir === repo || workingDir.startsWith(`${repo}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

/**
 * Which repo the Diffs page should open for a terminal session, and which
 * worktree to put it on.
 *
 * The branch decides the worktree: a project terminal runs in the project's
 * docs directory whichever branch it targets, so the path cannot tell the two
 * apart. The path only picks the repo, and only when the workspace has several.
 */
export function resolveDiffTarget(
  session: DiffSession,
  worktreeGroups: WorktreeBranchGroup[],
  repos: string[],
): DiffTarget | null {
  const branch = session.worktreeBranch ?? null;
  const group = branch ? worktreeGroups.find((g) => g.branch === branch) : undefined;

  if (group) {
    const byPath = group.repos.find((r) => r.worktreePath === session.workingDir);
    const withinRepo = group.repos.find((r) => containingRepo(session.workingDir, [r.repoPath]));
    const repoDir = (byPath ?? withinRepo ?? group.repos[0])?.repoPath;
    if (repoDir) return { repoDir, worktreeBranch: branch };
  }

  const repoDir = containingRepo(session.workingDir, repos) ?? (repos.length === 1 ? repos[0] : null);
  if (!repoDir) return null;
  return { repoDir, worktreeBranch: branch };
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
