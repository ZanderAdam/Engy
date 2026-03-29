'use client';

import { RiHammerLine, RiMore2Line, RiPlayLine, RiStopLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useQuickAction } from '@/hooks/use-quick-action';
import { useExecutionStatus } from '@/hooks/use-execution-status';

interface MilestoneQuickActionsProps {
  milestoneRef: string;
}

export function MilestoneQuickActions({ milestoneRef }: MilestoneQuickActionsProps) {
  const { disabled, launch, projectSlug, workspace } = useQuickAction();
  const {
    isActive,
    start: startExecution,
    stop: stopExecution,
  } = useExecutionStatus('milestone', milestoneRef);

  function handleImplementMilestone() {
    const useContainer = workspace?.containerEnabled ?? false;
    launch({
      prompt: `Use /engy:implement-milestone for ${milestoneRef} in project ${projectSlug}`,
      scopeLabel: `impl-ms: ${milestoneRef}`,
      containerMode: useContainer ? 'container' : undefined,
    });
  }

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
              onClick={handleImplementMilestone}
            >
              <RiHammerLine className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Implement Milestone</p>
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
            <DropdownMenuItem disabled={disabled} onClick={() => startExecution()}>
              <RiPlayLine className="size-4" />
              Execute Milestone
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
