'use client';

import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  RiInboxLine,
} from '@remixicon/react';
import { TASK_STATUSES, type TaskStatus } from '@/lib/task-status';

export const taskStatusOptions = TASK_STATUSES;

export const taskStatusColors: Record<string, string> = {
  backlog: 'text-zinc-500',
  todo: 'text-muted-foreground',
  in_progress: 'text-blue-500',
  review: 'text-yellow-500',
  done: 'text-green-500',
};

export const taskStatusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  backlog: RiInboxLine,
  todo: RiCircleLine,
  in_progress: RiLoader4Line,
  review: RiEyeLine,
  done: RiCheckboxCircleLine,
};

export const taskStatusLabels: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

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

  function handleStatusChange(value: string) {
    if (value === status) return;
    updateTask.mutate({ id: taskId, status: value as TaskStatus });
  }

  const Icon = taskStatusIcons[status] ?? RiCircleLine;
  const label = taskStatusLabels[status] ?? status;

  const button = (
    <button
      type="button"
      className={cn(
        'shrink-0 p-0.5',
        taskStatusColors[status],
        clickable && 'cursor-pointer hover:opacity-80',
        !clickable && 'cursor-default',
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );

  if (clickable) {
    return (
      <TooltipProvider delayDuration={300}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuRadioGroup value={status} onValueChange={handleStatusChange}>
              {taskStatusOptions.map((opt) => {
                const StatusIcon = taskStatusIcons[opt] ?? RiCircleLine;
                return (
                  <DropdownMenuRadioItem key={opt} value={opt} className={taskStatusColors[opt]}>
                    <StatusIcon className="mr-2 size-4" />
                    {taskStatusLabels[opt]}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
