'use client';

import {
  RiLoader4Line,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiPauseCircleLine,
  RiAlertLine,
  RiLightbulbLine,
  RiClipboardLine,
} from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ExecutionStatusIconProps {
  status: string | null;
  className?: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  active: RiLoader4Line,
  paused: RiPauseCircleLine,
  completed: RiCheckboxCircleLine,
  stopped: RiErrorWarningLine,
  planning: RiLightbulbLine,
  implementing: RiLoader4Line,
  blocked: RiPauseCircleLine,
  failed: RiAlertLine,
  plan_review: RiClipboardLine,
};

const tooltipMap: Record<string, string> = {
  active: 'Executing\u2026',
  paused: 'Execution paused',
  completed: 'Execution complete',
  stopped: 'Execution stopped',
  planning: 'Planning\u2026',
  implementing: 'Auto-implementing\u2026',
  blocked: 'Blocked',
  failed: 'Failed',
  plan_review: 'Plan ready for review',
};

const styleMap: Record<string, string> = {
  active: 'animate-spin text-blue-500',
  paused: 'text-yellow-500',
  completed: 'text-green-500',
  stopped: 'text-red-500',
  planning: 'text-purple-500',
  implementing: 'animate-spin text-blue-500',
  blocked: 'text-yellow-500',
  failed: 'text-red-500',
  plan_review: 'text-amber-500',
};

export function ExecutionStatusIcon({ status, className }: ExecutionStatusIconProps) {
  if (!status) return null;

  const Icon = iconMap[status];
  if (!Icon) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Icon className={cn('size-3 shrink-0', styleMap[status], className)} />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tooltipMap[status]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
