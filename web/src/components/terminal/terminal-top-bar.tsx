'use client';

import { RiGitPullRequestLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { VLink } from '@/components/tabs/virtual-link';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { TerminalTaskActions } from './terminal-task-actions';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';
import { useSessionBranch } from './use-session-branch';
import type { TerminalScope } from './types';

function useBranchDiffHref(scope: TerminalScope): string | null {
  const { projectSlug, workspaceSlug } = scope;
  // Follows the agent: a session that entered a worktree must link to that
  // worktree's review, not to the directory it was opened in.
  const workingDir = scope.agentCwd ?? scope.workingDir;

  const worktreeParam = useVirtualSearchParams().get('wt');
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  // A worktree lives outside its repo, so only git can say which repo it
  // belongs to and which branch it is on.
  const { branch, repoRoot } = useSessionBranch(scope);

  if (!projectSlug) return null;
  const target = resolveDiffTarget({
    gitRepoRoot: repoRoot,
    gitBranch: branch,
    workingDir,
    repos: (workspace?.repos as string[] | null) ?? [],
  });
  if (!target) return null;
  return branchDiffHref({ workspaceSlug, projectSlug, target, worktreeParam });
}

/**
 * Chrome above a terminal: what the session is working on and where to review
 * the result. Rendered only when the scope carries at least one of the two.
 */
export function TerminalTopBar({ scope }: { scope: TerminalScope }) {
  const diffHref = useBranchDiffHref(scope);
  if (scope.taskId == null && !diffHref) return null;

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-xs">
      {scope.taskId != null && (
        <TerminalTaskActions taskId={scope.taskId} workspaceSlug={scope.workspaceSlug} />
      )}
      {diffHref && (
        <VLink
          href={diffHref}
          aria-label="Review this branch"
          className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <RiGitPullRequestLine className="size-3.5" />
          Diff
        </VLink>
      )}
    </div>
  );
}
