import { repoLinkValue } from '@/lib/repo-name';

interface DiffTarget {
  /** The repo as the link writes it — its name, or its path when the name is shared. */
  repo: string;
  /** Null when git spoke for another repo, so the page keeps its own default. */
  branch: string | null;
}

function containingRepo(workingDir: string, repos: string[]): string | null {
  return (
    repos
      .filter((repo) => workingDir === repo || workingDir.startsWith(`${repo}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

/**
 * Which repo and branch a terminal's Diff link should open.
 *
 * Git answers first: from inside a worktree it names the repo the worktree was
 * created from, which no path comparison can recover. When git names a repo
 * the workspace does not have — a docs directory Engy keeps its own history in
 * — its branch belongs to that other repo, so the link names a repo by path
 * and leaves the branch to the page.
 */
export function resolveDiffTarget(args: {
  gitRepoRoot: string | null;
  gitBranch: string | null;
  workingDir: string;
  repos: string[];
}): DiffTarget | null {
  const { gitRepoRoot, gitBranch, workingDir, repos } = args;
  if (gitRepoRoot && repos.includes(gitRepoRoot) && gitBranch) {
    return { repo: repoLinkValue(gitRepoRoot, repos), branch: gitBranch };
  }
  const repoDir = containingRepo(workingDir, repos) ?? (repos.length === 1 ? repos[0] : null);
  return repoDir ? { repo: repoLinkValue(repoDir, repos), branch: null } : null;
}

export function branchDiffHref(args: {
  workspaceSlug: string;
  projectSlug: string;
  target: DiffTarget;
  /** The tab's current `?wt`, carried through untouched: it is the tab's and
   *  the terminal dock's identity, not the review target. Dropping it moves the
   *  tab to another group and the session vanishes from the dock. */
  worktreeParam?: string | null;
}): string {
  const params = new URLSearchParams({
    diffView: 'branch',
    diffRepo: args.target.repo,
  });
  if (args.target.branch) params.set('diffBranch', args.target.branch);
  if (args.worktreeParam) params.set('wt', args.worktreeParam);
  return `/w/${args.workspaceSlug}/projects/${args.projectSlug}/diffs?${params.toString()}`;
}
