'use client';

import { useParams } from 'next/navigation';
import { RiMore2Line, RiDraftLine, RiHammerLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { trpc } from '@/lib/trpc';
import { buildQuickActionDirs, buildContextBlock, buildClaudeCommand } from '@/lib/shell';
import { toast } from 'sonner';

const DEFAULT_PLAN_SKILL = '/engy:plan';
const DEFAULT_IMPLEMENT_SKILL = '/engy:implement';

interface TaskQuickActionsProps {
  taskId: number;
  needsPlan?: boolean;
  projectSlug?: string;
}

export function TaskQuickActions({ taskId, needsPlan = true, projectSlug: projectSlugProp }: TaskQuickActionsProps) {
  const params = useParams<{ workspace: string; project: string }>();
  const workspaceSlug = params.workspace ?? '';
  const projectSlug = projectSlugProp ?? params.project;

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const { openNewTerminal } = useSendToTerminal();

  const repos = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];
  const projectDir = project?.projectDir;
  const planSlugs = project?.planSlugs ?? [];
  const planSkill = workspace?.planSkill || DEFAULT_PLAN_SKILL;
  const implementSkill = workspace?.implementSkill || DEFAULT_IMPLEMENT_SKILL;

  const taskSlug = `${workspaceSlug}-T${taskId}`;
  const hasPlan = planSlugs.includes(taskSlug);

  const { workingDir, additionalDirs } = buildQuickActionDirs(repos, projectDir);

  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.get.invalidate();
      utils.task.list.invalidate();
      utils.task.listBySpecId.invalidate();
    },
    onError: () => {
      toast.error('Failed to update task');
    },
  });

  function handlePlan() {
    if (!workingDir || !projectDir || !workspace || !project || !projectSlug) return;
    const ctx = buildContextBlock({
      workspace: { id: workspace.id, slug: workspaceSlug },
      project: { id: project.id, slug: projectSlug, dir: projectDir },
      repos,
    });
    const skillLine = `Use ${planSkill} to plan ${taskSlug}, output plan to ${projectDir}/plans/${taskSlug}.plan.md`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `plan: ${taskSlug}`,
      workingDir,
      command: buildClaudeCommand({ prompt: skillLine, systemPrompt: ctx, additionalDirs }),
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
    });
  }

  function handleImplement() {
    if (!workingDir || !projectDir || !workspace || !project || !projectSlug) return;
    const ctx = buildContextBlock({
      workspace: { id: workspace.id, slug: workspaceSlug },
      project: { id: project.id, slug: projectSlug, dir: projectDir },
      repos,
    });
    const skillLine = needsPlan
      ? `Use ${implementSkill} for ${taskSlug}, plan at ${projectDir}/plans/${taskSlug}.plan.md`
      : `Use ${implementSkill} for ${taskSlug}`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `impl: ${taskSlug}`,
      workingDir,
      command: buildClaudeCommand({ prompt: skillLine, systemPrompt: ctx, additionalDirs }),
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
    });
  }

  function handleToggleNeedsPlan() {
    updateTask.mutate({ id: taskId, needsPlan: !needsPlan });
  }

  const actionDisabled = !workingDir || !projectDir;
  const showImplement = !needsPlan || hasPlan;

  const tooltip = actionDisabled
    ? 'No project directory'
    : showImplement
      ? 'Start Implementing'
      : 'Start Planning';

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              disabled={actionDisabled}
              onClick={showImplement ? handleImplement : handlePlan}
            >
              {showImplement ? <RiHammerLine className="size-3" /> : <RiDraftLine className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
          >
            <RiMore2Line className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          {needsPlan && hasPlan && (
            <>
              <DropdownMenuItem disabled={actionDisabled} onClick={handlePlan}>
                <RiDraftLine className="size-4" />
                Replan
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={handleToggleNeedsPlan}>
            {needsPlan ? 'Skip planning' : 'Require planning'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
