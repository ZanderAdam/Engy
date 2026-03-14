'use client';

import { useParams } from 'next/navigation';
import { RiRocketLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { trpc } from '@/lib/trpc';
import { buildQuickActionDirs, buildContextBlock, buildClaudeCommand } from '@/lib/shell';

interface MilestoneQuickActionsProps {
  milestoneRef: string;
}

export function MilestoneQuickActions({ milestoneRef }: MilestoneQuickActionsProps) {
  const params = useParams<{ workspace: string; project: string }>();
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

  const actionDisabled = !workingDir || !projectDir;

  function handleImplementMilestone() {
    if (!workingDir || !projectDir || !workspace || !project) return;
    const ctx = buildContextBlock({
      workspace: { id: workspace.id, slug: workspaceSlug },
      project: { id: project.id, slug: projectSlug, dir: projectDir },
      repos,
    });
    const skillLine = `Use /engy:implement-milestone for ${milestoneRef} in project ${projectSlug}`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `impl-ms: ${milestoneRef}`,
      workingDir,
      command: buildClaudeCommand({ prompt: skillLine, systemPrompt: ctx, additionalDirs }),
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
    });
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            disabled={actionDisabled}
            onClick={(e) => {
              e.stopPropagation();
              handleImplementMilestone();
            }}
          >
            <RiRocketLine className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Implement Milestone</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
