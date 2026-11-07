'use client';

import { RiGitPullRequestLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { VLink } from '@/components/tabs/virtual-link';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { TerminalTaskActions } from './terminal-task-actions';
import { orderTaskIds } from './terminal-task-actions.helpers';
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
 * the result. Rendered only when the session has a task or a diff to review.
 */
export function TerminalTopBar({ sessionId, scope }: { sessionId: string; scope: TerminalScope }) {
  const diffHref = useBranchDiffHref(scope);
  const { data: linkedTaskIds } = trpc.terminal.linkedTasks.useQuery(
    { sessionId },
    { enabled: !!scope.agentType },
  );
  const taskIds = orderTaskIds(scope.taskId, linkedTaskIds ?? []);
  if (taskIds.length === 0 && !diffHref) return null;

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-xs">
      {taskIds.length > 0 && (
        <TerminalTaskActions taskIds={taskIds} workspaceSlug={scope.workspaceSlug} />
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
