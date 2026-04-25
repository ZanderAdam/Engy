'use client';

import { useVirtualParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { buildQuickActionDirs, buildContextBlock, buildClaudeCommand } from '@/lib/shell';
import type { ContainerMode, TerminalScope } from '@/components/terminal/types';

export function useQuickAction() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
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

  const { openNewTerminal } = useSendToTerminal();

  const repos = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];
  const projectDir = project?.projectDir;
  const { workingDir, additionalDirs } = buildQuickActionDirs(repos, projectDir);
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
      repos,
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
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
      workspaceSlug,
      containerMode: opts.containerMode,
      taskId: opts.taskId,
    };
    openNewTerminal(scope);
  }

  return { disabled, launch, projectSlug, workspace, project };
}
