'use client';

import { RiMore2Line, RiDraftLine } from '@remixicon/react';
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
}

export function TaskQuickActions({ taskId, workspaceSlug }: TaskQuickActionsProps) {
  const { sendToTerminal, terminalActive } = useSendToTerminal();
  const taskSlug = `${workspaceSlug}-T${taskId}`;

  const menuItem = (
    <DropdownMenuItem
      disabled={!terminalActive}
      onClick={() => sendToTerminal(`Use /engy:planning to plan ${taskSlug}`)}
    >
      <RiDraftLine className="size-4" />
      Start Planning
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <RiMore2Line className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {!terminalActive ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>{menuItem}</TooltipTrigger>
              <TooltipContent side="left">
                <p>No active terminal</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          menuItem
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
