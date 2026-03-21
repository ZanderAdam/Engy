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

import { ExecutionStatusIcon } from '@/components/projects/execution-status-icon';
import type { Task } from '@/components/projects/types';

interface TaskCardProps {
  task: Task;
  projectSlug?: string;
  onClick?: () => void;
  showCheckbox?: boolean;
  onCheckboxChange?: (done: boolean) => void;
  borderClass?: string;
  className?: string;
}

const milestoneColors = [
  'bg-blue-500/20 text-blue-400',
  'bg-green-500/20 text-green-400',
  'bg-purple-500/20 text-purple-400',
  'bg-orange-500/20 text-orange-400',
  'bg-pink-500/20 text-pink-400',
  'bg-cyan-500/20 text-cyan-400',
  'bg-amber-500/20 text-amber-400',
  'bg-red-500/20 text-red-400',
];

const groupColors = [
  'bg-teal-500/20 text-teal-400',
  'bg-violet-500/20 text-violet-400',
  'bg-rose-500/20 text-rose-400',
  'bg-lime-500/20 text-lime-400',
  'bg-sky-500/20 text-sky-400',
  'bg-fuchsia-500/20 text-fuchsia-400',
  'bg-yellow-500/20 text-yellow-400',
  'bg-indigo-500/20 text-indigo-400',
];

function parseMilestoneNum(ref: string): number {
  const match = ref.match(/^m(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function colorByIndex(index: number, palette: string[]): string {
  return palette[((index - 1) % palette.length + palette.length) % palette.length];
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
        {(task.milestoneRef || task.taskGroupId || task.subStatus) && (
          <div className="ml-auto flex items-center gap-1">
            {task.milestoneRef && (() => {
              const num = parseMilestoneNum(task.milestoneRef);
              return (
                <span className={cn('rounded px-1 py-0.5 text-[10px] font-medium leading-none', colorByIndex(num, milestoneColors))}>
                  M{num}
                </span>
              );
            })()}
            {task.taskGroupId && (
              <span className={cn('rounded px-1 py-0.5 text-[10px] font-medium leading-none', colorByIndex(task.taskGroupId, groupColors))}>
                TG{task.taskGroupId}
              </span>
            )}
            <ExecutionStatusIcon status={task.subStatus} />
          </div>
        )}
      </div>
      <div className={cn(showCheckbox && isDone && 'line-through')}>
        {task.title}
      </div>
    </div>
  );
}
