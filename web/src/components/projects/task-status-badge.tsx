'use client';

import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  RiCircleLine,
  RiLoader4Line,
  RiEyeLine,
  RiCheckboxCircleLine,
} from '@remixicon/react';

export const taskStatusOptions = ['todo', 'in_progress', 'review', 'done'] as const;
type TaskStatus = (typeof taskStatusOptions)[number];

export const taskStatusColors: Record<string, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-blue-500',
  review: 'text-yellow-500',
  done: 'text-green-500',
};

const taskStatusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  todo: RiCircleLine,
  in_progress: RiLoader4Line,
  review: RiEyeLine,
  done: RiCheckboxCircleLine,
};

const taskStatusLabels: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

function nextStatus(current: string): TaskStatus {
  const idx = taskStatusOptions.indexOf(current as TaskStatus);
  if (idx === -1 || idx === taskStatusOptions.length - 1) return taskStatusOptions[0];
  return taskStatusOptions[idx + 1];
}

export function TaskStatusBadge({
  taskId,
  status,
  clickable = false,
  className,
}: {
  taskId: number;
  status: string;
  clickable?: boolean;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.get.invalidate();
      utils.task.list.invalidate();
    },
  });

  function handleClick(e: React.MouseEvent) {
    if (!clickable) return;
    e.stopPropagation();
    updateTask.mutate({ id: taskId, status: nextStatus(status) });
  }

  const Icon = taskStatusIcons[status] ?? RiCircleLine;
  const label = taskStatusLabels[status] ?? status;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'shrink-0 p-0.5',
              taskStatusColors[status],
              clickable && 'cursor-pointer hover:opacity-80',
              !clickable && 'cursor-default',
              className,
            )}
            onClick={clickable ? handleClick : undefined}
          >
            <Icon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
