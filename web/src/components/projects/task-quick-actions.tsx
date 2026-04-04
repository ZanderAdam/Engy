'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RiMore2Line,
  RiDraftLine,
  RiFileTextLine,
  RiHammerLine,
  RiPlayLine,
  RiStopLine,
  RiCloudLine,
  RiChat3Line,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';
import { useQuickAction } from '@/hooks/use-quick-action';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { toast } from 'sonner';

const DEFAULT_PLAN_SKILL = '/engy:plan';
const DEFAULT_IMPLEMENT_SKILL = '/engy:implement';

interface TaskQuickActionsProps {
  taskId: number;
  needsPlan?: boolean;
  projectSlug?: string;
}

export function TaskQuickActions({
  taskId,
  needsPlan = true,
  projectSlug: projectSlugProp,
}: TaskQuickActionsProps) {
  const router = useRouter();
  const { disabled, launch, projectSlug: hookProjectSlug, workspace, project } = useQuickAction();
  const projectSlug = projectSlugProp ?? hookProjectSlug;
  const workspaceSlug = workspace?.slug ?? '';

  const planSlugs = project?.planSlugs ?? [];
  const planSkill = workspace?.planSkill || DEFAULT_PLAN_SKILL;
  const implementSkill = workspace?.implementSkill || DEFAULT_IMPLEMENT_SKILL;

  const taskSlug = `${workspaceSlug}-T${taskId}`;
  const hasPlan = planSlugs.includes(taskSlug);
  const projectDir = project?.projectDir;

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState('');

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

  // Planning always runs on host — read-only analysis, no need for container sandbox
  function handlePlan(replan = false) {
    if (!projectDir || !projectSlug) return;
    const planPath = `${projectDir}/plans/${taskSlug}.plan.md`;
    const prompt = replan
      ? `Use ${planSkill} to replan ${taskSlug}, existing plan at ${planPath}. Replan based on the updated task description.`
      : `Use ${planSkill} to plan ${taskSlug}, output plan to ${planPath}`;
    launch({
      prompt,
      scopeLabel: `${replan ? 'replan' : 'plan'}: ${taskSlug}`,
      containerMode: 'host',
      taskId,
    });
  }

  function handleImplement() {
    if (!projectDir || !projectSlug) return;
    const useContainer = workspace?.containerEnabled ?? false;
    const prompt = needsPlan
      ? `Use ${implementSkill} for ${taskSlug}, plan at ${projectDir}/plans/${taskSlug}.plan.md`
      : `Use ${implementSkill} for ${taskSlug}`;
    launch({
      prompt,
      scopeLabel: `impl: ${taskSlug}`,
      containerMode: useContainer ? 'container' : undefined,
      taskId,
    });
  }

  function handleToggleNeedsPlan() {
    updateTask.mutate({ id: taskId, needsPlan: !needsPlan });
  }

  function handlePromptSubmit() {
    if (!promptText.trim()) return;
    const prompt = `${promptText.trim()}\n\nTask: ${taskSlug}`;
    launch({ prompt, scopeLabel: `prompt: ${taskSlug}`, taskId });
    setPromptOpen(false);
    setPromptText('');
  }

  const { isActive, start: startExecution, stop: stopExecution } = useExecutionStatus('task', taskId);
  const remoteEnabled = workspace?.remoteEnabled ?? false;

  const showImplement = !needsPlan || hasPlan;

  const tooltip = disabled
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
              disabled={disabled || isActive}
              onClick={showImplement ? handleImplement : () => handlePlan()}
            >
              {showImplement ? (
                <RiHammerLine className="size-3" />
              ) : (
                <RiDraftLine className="size-3" />
              )}
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
          {isActive ? (
            <DropdownMenuItem onClick={stopExecution}>
              <RiStopLine className="size-4" />
              Stop Execution
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem disabled={disabled} onClick={() => startExecution()}>
                <RiPlayLine className="size-4" />
                Execute in Background
              </DropdownMenuItem>
              {remoteEnabled && (
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={() => startExecution({ remote: true })}
                >
                  <RiCloudLine className="size-4" />
                  Execute Remotely
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={disabled} onClick={() => setPromptOpen(true)}>
                <RiChat3Line className="size-4" />
                Start with prompt
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {needsPlan && hasPlan && (
            <>
              <DropdownMenuItem
                onClick={() =>
                  router.push(
                    `/w/${workspaceSlug}/projects/${projectSlug}/docs?file=plans/${taskSlug}.plan.md`,
                  )
                }
              >
                <RiFileTextLine className="size-4" />
                View Plan
              </DropdownMenuItem>
              <DropdownMenuItem disabled={disabled} onClick={() => handlePlan(true)}>
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

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start with prompt</DialogTitle>
            <DialogDescription>Enter a prompt to start working on {taskSlug}</DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="What would you like to do?"
            rows={4}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && promptText.trim()) {
                handlePromptSubmit();
              }
            }}
          />
          <DialogFooter>
            <Button onClick={handlePromptSubmit} disabled={!promptText.trim()}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
