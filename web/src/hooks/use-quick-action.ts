'use client';

import { useVirtualParams, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { buildQuickActionDirs, buildContextBlock, buildClaudeCommand } from '@/lib/shell';
import { projectGroupKey, normalizeWtParam } from '@/components/terminal/group-key';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import type { ContainerMode, TerminalScope } from '@/components/terminal/types';

export function useQuickAction() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const searchParams = useVirtualSearchParams();
  const workspaceSlug = params.workspace ?? '';
  const projectSlug = params.project ?? '';

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug },
    { enabled: !!workspace && !!projectSlug },
  );

  // Combined mode runs quick actions on the default branch (worktrees are a
  // terminal-only dimension), so `?wt` is ignored for cwd and groupKey.
  const combined = workspace?.combinedWorktrees ?? false;
  const worktreeBranch = combined ? undefined : normalizeWtParam(searchParams.get('wt'));

  const { repoMap: worktreeRepoMap } = useProjectWorktreeMap({
    projectId: project?.id,
    combined,
  });

  const { openNewTerminal } = useSendToTerminal();

  const repos = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];
  const effectiveRepos = worktreeBranch
    ? repos.map((r) => worktreeRepoMap.get(r) ?? r)
    : repos;

  const projectDir = project?.projectDir;
  const { workingDir, additionalDirs } = buildQuickActionDirs(effectiveRepos, projectDir);
  const disabled = !workingDir || !projectDir;

  function launch(opts: {
    prompt: string;
    scopeLabel: string;
    containerMode?: ContainerMode;
    taskId?: number;
  }) {
    if (!workingDir || !projectDir || !workspace || !project) return;
    const ctx = buildContextBlock({
      workspace: { id: workspace.id, slug: workspaceSlug },
      project: { id: project.id, slug: projectSlug, dir: projectDir },
      repos: effectiveRepos,
      earsBdd: workspace.earsBdd ?? false,
    });
    const isContainer = opts.containerMode === 'container';
    const scope: TerminalScope = {
      scopeType: 'project',
      scopeLabel: opts.scopeLabel,
      workingDir,
      command: buildClaudeCommand({
        prompt: opts.prompt,
        systemPrompt: ctx,
        additionalDirs,
        dangerouslySkipPermissions: isContainer,
      }),
      groupKey: projectGroupKey(workspaceSlug, projectSlug, worktreeBranch),
      workspaceSlug,
      containerMode: opts.containerMode,
      taskId: opts.taskId,
      projectId: project.id,
      projectSlug,
    };
    openNewTerminal(scope);
  }

  return { disabled, launch, projectSlug, workspace, project };
}
