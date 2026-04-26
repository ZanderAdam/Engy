'use client';

import { useMemo } from 'react';
import { useVirtualParams } from '@/components/tabs/tab-context';
import { Button } from '@/components/ui/button';
import { TaskStatusBadge } from '@/components/projects/task-status-badge';
import { CopyTaskSlug } from '@/components/projects/copy-task-slug';
import { TaskQuickActions } from '@/components/projects/task-quick-actions';
import { TaskTerminalButton } from '@/components/projects/task-terminal-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  RiCheckboxLine,
  RiCheckboxBlankLine,
  RiDraggable,
  RiUserLine,
  RiRobotLine,
  RiQuestionLine,
} from '@remixicon/react';

import { useExecutionStatus } from '@/hooks/use-execution-status';
import { useTerminalActivity } from '@/hooks/use-terminal-activity';
import { ExecutionStatusIcon } from '@/components/projects/execution-status-icon';
import { useTaskTerminals } from '@/hooks/use-task-terminals';
import type { Task } from '@/components/projects/types';

interface TaskCardProps {
  task: Task;
  projectSlug?: string;
  onClick?: () => void;
  showCheckbox?: boolean;
  onCheckboxChange?: (done: boolean) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: number) => void;
  borderClass?: string;
  className?: string;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
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
  selectable = false,
  selected = false,
  onSelect,
  borderClass,
  className,
  dragHandleProps,
}: TaskCardProps) {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const groupKey =
    params.workspace && params.project
      ? `project:${params.workspace}:${params.project}`
      : undefined;
  const taskTerminals = useTaskTerminals(groupKey);
  const terminalSessions = taskTerminals.get(task.id) ?? [];
  const sessionIds = useMemo(() => terminalSessions.map((s) => s.sessionId), [terminalSessions]);
  const terminalActivity = useTerminalActivity(sessionIds);

  const isDone = task.status === 'done';
  const { status: sessionStatus } = useExecutionStatus('task', task.id);
  const execStatus = sessionStatus === 'active' ? sessionStatus : (task.subStatus ?? sessionStatus);
  const typeInfo = typeIcons[task.type] ?? typeIcons.human;
  const TypeIcon = typeInfo.icon;
  const nextType = task.type === 'human' ? 'ai' : 'human';

  const { data: unansweredByTask } = trpc.question.unansweredByTask.useQuery(
    { projectId: task.projectId ?? undefined },
    { enabled: !!task.projectId },
  );
  const unansweredCount = unansweredByTask?.[task.id] ?? 0;
  const needsAttention = terminalActivity === 'waiting' || unansweredCount > 0;

  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.get.invalidate();
      utils.task.list.invalidate();
    },
  });

  const handleClick = selectable
    ? () => onSelect?.(task.id)
    : onClick;

  return (
    <div
      role={handleClick ? 'button' : undefined}
      tabIndex={handleClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      } : undefined}
      className={cn(
        'group/task text-left text-xs transition-colors hover:bg-muted',
        borderClass && `border-l-2 ${borderClass}`,
        needsAttention && 'ring-1 ring-inset ring-amber-400/50',
        selectable && selected && 'ring-1 ring-inset ring-primary',
        showCheckbox && isDone && 'opacity-50',
        handleClick && 'cursor-pointer',
        dragHandleProps ? 'flex' : 'space-y-0.5 p-2',
        className,
      )}
    >
      {dragHandleProps && (
        <button
          type="button"
          className="flex shrink-0 cursor-grab items-center px-1.5 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          {...dragHandleProps}
        >
          <RiDraggable className="size-3" />
        </button>
      )}
      <div className={cn('min-w-0 flex-1 space-y-0.5', dragHandleProps ? 'py-2 pr-2' : 'contents')}>
      <div className="flex items-center gap-1.5">
        {selectable && (
          <span className="flex shrink-0 items-center justify-center">
            {selected ? (
              <RiCheckboxLine className="size-4 text-primary" />
            ) : (
              <RiCheckboxBlankLine className="size-4 text-muted-foreground" />
            )}
          </span>
        )}
        {showCheckbox && !selectable && (
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
        <TaskQuickActions
          taskId={task.id}
          status={task.status}
          needsPlan={task.needsPlan}
          projectSlug={projectSlug}
        />
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
        {(task.milestoneRef || task.taskGroupId || execStatus || unansweredCount > 0 || terminalSessions.length > 0) && (
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
            <TaskTerminalButton sessions={terminalSessions} />
            {execStatus === 'plan_review' ? (
              <button
                type="button"
                aria-label="Open plan review"
                className="flex shrink-0 cursor-pointer items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent('task:open', {
                      detail: { taskId: task.id, tab: 'plan' },
                    }),
                  );
                }}
              >
                <ExecutionStatusIcon status={execStatus} />
              </button>
            ) : (
              <ExecutionStatusIcon status={execStatus} />
            )}
            {unansweredCount > 0 && (
              <RiQuestionLine className="size-3.5 animate-bounce text-amber-400" />
            )}
          </div>
        )}
      </div>
      <div className={cn(showCheckbox && isDone && 'line-through')}>
        {task.title}
      </div>
      </div>
    </div>
  );
}
