'use client';

import { RiMore2Line, RiDraftLine, RiPlayLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';

interface TaskQuickActionsProps {
  taskId: number;
  workspaceSlug: string;
  projectDir?: string | null;
  planSlugs?: string[];
}

export function TaskQuickActions({
  taskId,
  workspaceSlug,
  projectDir,
  planSlugs,
}: TaskQuickActionsProps) {
  const { sendToTerminal, openNewTerminal, terminalActive } = useSendToTerminal();
  const taskSlug = `${workspaceSlug}-T${taskId}`;
  const hasPlan = planSlugs?.includes(taskSlug) ?? false;

  function handlePlan() {
    if (!projectDir) return;
    const prompt = `Use /engy:planning to plan ${taskSlug}, output plan to ${projectDir}/plans/${taskSlug}.plan.md`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `plan: ${taskSlug}`,
      workingDir: projectDir,
      command: `claude "${prompt}" --add-dir "${projectDir}"`,
    });
  }

  function handleImplement() {
    if (!projectDir) return;
    sendToTerminal(
      `Use /engy:implement-plan for ${taskSlug}, plan at ${projectDir}/plans/${taskSlug}.plan.md`,
    );
  }

  const planDisabled = !projectDir;
  const implementDisabled = !terminalActive || !projectDir;
  const implementTooltip = !terminalActive ? 'No active terminal' : 'No project directory';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 border border-border text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <RiMore2Line className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DisabledTooltip tooltip="No project directory" show={planDisabled}>
          <DropdownMenuItem disabled={planDisabled} onClick={handlePlan}>
            <RiDraftLine className="size-4" />
            {hasPlan ? 'Replan' : 'Start Planning'}
          </DropdownMenuItem>
        </DisabledTooltip>
        {hasPlan && (
          <DisabledTooltip tooltip={implementTooltip} show={implementDisabled}>
            <DropdownMenuItem disabled={implementDisabled} onClick={handleImplement}>
              <RiPlayLine className="size-4" />
              Implement
            </DropdownMenuItem>
          </DisabledTooltip>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DisabledTooltip({
  children,
  tooltip,
  show,
}: {
  children: React.ReactNode;
  tooltip: string;
  show: boolean;
}) {
  if (!show) return children;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="left">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
