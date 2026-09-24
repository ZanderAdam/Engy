'use client';

import { RiGitPullRequestLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { VLink } from '@/components/tabs/virtual-link';
import { TerminalTaskActions } from './terminal-task-actions';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';
import type { TerminalScope } from './types';

function useBranchDiffHref(scope: TerminalScope): string | null {
  const { projectSlug, workspaceSlug } = scope;
  // Follows the agent: a session spawned in the main checkout that entered a
  // worktree must link to that worktree's review, not its spawn directory's.
  const workingDir = scope.agentCwd ?? scope.workingDir;

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  // A session restored from the session list carries `projectSlug` but no
  // `projectId`, so the id is resolved here rather than read off the scope —
  // without it a worktree session gets no worktree map, and a worktree lives
  // outside its repo, so nothing would map it back.
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const { data: worktrees } = trpc.worktree.listGrouped.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );

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
