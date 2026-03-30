'use client';

import { RiTerminalLine } from '@remixicon/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { TaskTerminalSession } from '@/hooks/use-task-terminals';

interface TaskTerminalButtonProps {
  sessions: TaskTerminalSession[];
}

function focusTerminal(sessionId: string) {
  window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId } }));
}

export function TaskTerminalButton({ sessions }: TaskTerminalButtonProps) {
  if (sessions.length === 0) return null;

  if (sessions.length === 1) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                focusTerminal(sessions[0].sessionId);
              }}
            >
              <RiTerminalLine className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {sessions[0].scopeLabel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <RiTerminalLine className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {sessions.length} terminals
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          {sessions.map((s) => (
            <DropdownMenuItem key={s.sessionId} onClick={() => focusTerminal(s.sessionId)}>
              <RiTerminalLine className="size-4" />
              {s.scopeLabel}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
