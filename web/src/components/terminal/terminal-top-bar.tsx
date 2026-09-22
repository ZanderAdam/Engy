'use client';

import { RiGitPullRequestLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { VLink } from '@/components/tabs/virtual-link';
import { TerminalTaskActions } from './terminal-task-actions';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';
import type { TerminalScope } from './types';

function useBranchDiffHref(scope: TerminalScope): string | null {
  const { projectId, projectSlug, workspaceSlug, workingDir } = scope;

  const { data: worktrees } = trpc.worktree.listGrouped.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId },
  );
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  if (!projectSlug) return null;
  const target = resolveDiffTarget(
    workingDir,
    worktrees?.groups ?? [],
    (workspace?.repos as string[] | null) ?? [],
  );
  if (!target) return null;
  return branchDiffHref({ workspaceSlug, projectSlug, target });
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
