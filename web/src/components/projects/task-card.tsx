'use client';

import { Button } from '@/components/ui/button';
import { TaskStatusBadge } from '@/components/projects/task-status-badge';
import { CopyTaskSlug } from '@/components/projects/copy-task-slug';
import { TaskQuickActions } from '@/components/projects/task-quick-actions';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  RiCheckboxLine,
  RiCheckboxBlankLine,
  RiUserLine,
  RiRobotLine,
} from '@remixicon/react';

interface TaskCardProps {
  task: { id: number; title: string; status: string; type: string; needsPlan?: boolean };
  projectSlug?: string;
  onClick?: () => void;
  showCheckbox?: boolean;
  onCheckboxChange?: (done: boolean) => void;
  borderClass?: string;
  className?: string;
}

const typeIcons: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  human: { icon: RiUserLine, label: 'Human' },
  ai: { icon: RiRobotLine, label: 'AI' },
};

export function TaskCard({
  task,
  projectSlug,
  onClick,
  showCheckbox = false,
  onCheckboxChange,
  borderClass,
  className,
}: TaskCardProps) {
  const isDone = task.status === 'done';
  const typeInfo = typeIcons[task.type] ?? typeIcons.human;
  const TypeIcon = typeInfo.icon;
  const nextType = task.type === 'human' ? 'ai' : 'human';

  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.get.invalidate();
      utils.task.list.invalidate();
    },
  });

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      } : undefined}
      className={cn(
        'group/task space-y-0.5 p-2 text-left text-xs transition-colors hover:bg-muted',
        borderClass && `border-l-2 ${borderClass}`,
        showCheckbox && isDone && 'opacity-50',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {showCheckbox && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onCheckboxChange?.(!isDone);
            }}
          >
            {isDone ? (
              <RiCheckboxLine className="size-4" />
            ) : (
              <RiCheckboxBlankLine className="size-4" />
            )}
          </Button>
        )}
        <CopyTaskSlug taskId={task.id} />
        <TaskQuickActions taskId={task.id} needsPlan={task.needsPlan} projectSlug={projectSlug} />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 cursor-pointer text-muted-foreground hover:opacity-80"
                onClick={(e) => {
                  e.stopPropagation();
                  updateTask.mutate({ id: task.id, type: nextType });
                }}
              >
                <TypeIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {typeInfo.label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TaskStatusBadge taskId={task.id} status={task.status} clickable className="shrink-0" />
      </div>
      <div className={cn(showCheckbox && isDone && 'line-through')}>
        {task.title}
      </div>
    </div>
  );
}
