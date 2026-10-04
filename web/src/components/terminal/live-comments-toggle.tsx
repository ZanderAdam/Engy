'use client';

import { RiBroadcastLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface LiveCommentsToggleProps {
  live: boolean;
  /** Name of the pinned terminal, when it is open in this browser tab. */
  liveLabel: string | null;
  terminalActive: boolean;
  busy?: boolean;
  onToggle: () => void;
  withText?: boolean;
}

function tooltipText(live: boolean, liveLabel: string | null, terminalActive: boolean): string {
  if (live) {
    const target = liveLabel ? `"${liveLabel}"` : 'the pinned terminal';
    return `Live: each new comment goes to ${target} as you write it. Click to stop.`;
  }
  if (!terminalActive) return 'No active terminal';
  return 'Go live: send each new comment to the focused terminal as you write it';
}

export function LiveCommentsToggle({
  live,
  liveLabel,
  terminalActive,
  busy,
  onToggle,
  withText,
}: LiveCommentsToggleProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            disabled={busy || (!live && !terminalActive)}
            aria-pressed={live}
            aria-label={live ? 'Stop live comments' : 'Start live comments'}
            className={cn(
              withText ? 'h-7 gap-1.5 px-2 text-xs' : 'h-6 w-6 p-0',
              live && 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary',
            )}
          >
            <RiBroadcastLine className={withText ? 'size-3.5' : 'size-3'} />
            {withText && 'Live'}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tooltipText(live, liveLabel, terminalActive)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
