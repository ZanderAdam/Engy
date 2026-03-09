'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskStatusBadge } from '@/components/projects/task-status-badge';
import { CopyTaskSlug } from '@/components/projects/copy-task-slug';
import { cn } from '@/lib/utils';
import { RiCheckboxLine, RiCheckboxBlankLine } from '@remixicon/react';

interface TaskCardProps {
  task: { id: number; title: string; status: string; type: string };
  workspaceSlug: string;
  onClick?: () => void;
  showCheckbox?: boolean;
  onCheckboxChange?: (done: boolean) => void;
  borderClass?: string;
  className?: string;
}

export function TaskCard({
  task,
  workspaceSlug,
  onClick,
  showCheckbox = false,
  onCheckboxChange,
  borderClass,
  className,
}: TaskCardProps) {
  const isDone = task.status === 'done';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      } : undefined}
      className={cn(
        'group/task flex items-center gap-2 p-2 text-left text-xs transition-colors hover:bg-muted',
        borderClass && `border-l-2 ${borderClass}`,
        showCheckbox && isDone && 'opacity-50',
        onClick && 'cursor-pointer',
        className,
      )}
    >
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
      <CopyTaskSlug taskId={task.id} workspaceSlug={workspaceSlug} />
      <span className={cn('flex-1 truncate', showCheckbox && isDone && 'line-through')}>
        {task.title}
      </span>
      <Badge variant="secondary" className="shrink-0 text-[10px]">
        {task.type}
      </Badge>
      <TaskStatusBadge taskId={task.id} status={task.status} clickable className="shrink-0" />
    </div>
  );
}
