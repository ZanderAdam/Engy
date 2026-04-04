'use client';

import { useState } from 'react';
import {
  RiArrowRightSLine,
  RiBox3Line,
  RiHammerLine,
  RiMore2Line,
  RiPlayLine,
  RiStopLine,
} from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MilestoneStatusBadge } from './milestone-status-badge';
import { MilestoneQuickActions } from './milestone-quick-actions';
import { TaskCard } from './task-card';
import { useQuickAction } from '@/hooks/use-quick-action';
import { useExecutionStatus } from '@/hooks/use-execution-status';
import { ExecutionStatusIcon } from './execution-status-icon';
import { MilestoneExecutionDialog } from './milestone-execution-dialog';
import { cn } from '@/lib/utils';
import type { Task } from './types';

type Milestone = {
  ref: string;
  num: number;
  title: string;
  status: string;
  scope?: string | null;
  filename: string;
};

type TaskGroup = { id: number; milestoneRef: string | null; name: string; status: string };

export function sortMilestones(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => {
    const aComplete = a.status === 'complete' ? 1 : 0;
    const bComplete = b.status === 'complete' ? 1 : 0;
    if (aComplete !== bComplete) return aComplete - bComplete;
    return a.num - b.num;
  });
}

function isAllDone(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.status === 'done');
}

export function sortTaskGroups(
  taskGroups: TaskGroup[],
  tasksByGroup: Map<number, Task[]>,
): TaskGroup[] {
  return [...taskGroups].sort((a, b) => {
    const aAllDone = isAllDone(tasksByGroup.get(a.id) ?? []) ? 1 : 0;
    const bAllDone = isAllDone(tasksByGroup.get(b.id) ?? []) ? 1 : 0;
    if (aAllDone !== bAllDone) return aAllDone - bAllDone;
    return a.id - b.id;
  });
}

function groupTasksByTg(tasks: Task[]): Map<number, Task[]> {
  const map = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.taskGroupId) {
      const group = map.get(t.taskGroupId) ?? [];
      group.push(t);
      map.set(t.taskGroupId, group);
    }
  }
  return map;
}

export function MilestoneList({
  projectId,
  milestones,
  showDone,
  onTaskClick,
  containerEnabled,
}: {
  projectId: number;
  milestones: Milestone[];
  showDone: boolean;
  onTaskClick?: (taskId: number) => void;
  containerEnabled?: boolean;
}) {
  const sorted = sortMilestones(milestones);

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((ms) => (
        <MilestoneRow
          key={ms.ref}
          projectId={projectId}
          milestone={ms}
          showDone={showDone}
          onTaskClick={onTaskClick}
          containerEnabled={containerEnabled}
        />
      ))}
      {sorted.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">No milestones yet</p>
      )}
    </div>
  );
}

function MilestoneRow({
  projectId,
  milestone,
  showDone,
  onTaskClick,
  containerEnabled,
}: {
  projectId: number;
  milestone: Milestone;
  showDone: boolean;
  onTaskClick?: (taskId: number) => void;
  containerEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [execDialogOpen, setExecDialogOpen] = useState(false);
  const {
    status: execStatus,
    sessionId: execSessionId,
    completionSummary: execSummary,
  } = useExecutionStatus('milestone', milestone.ref);
  const { data: tasks } = trpc.task.list.useQuery({
    projectId,
    milestoneRef: milestone.ref,
  });
  const { data: taskGroups, isLoading: groupsLoading } = trpc.taskGroup.list.useQuery({
    projectId,
    milestoneRef: milestone.ref,
  });

  const total = tasks?.length ?? 0;
  const done = tasks?.filter((t) => t.status === 'done').length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const tasksByGroup = groupTasksByTg(tasks ?? []);

  const ungroupedTasks = tasks?.filter((t) => !t.taskGroupId) ?? [];
  const visibleUngrouped = showDone
    ? ungroupedTasks
    : ungroupedTasks.filter((t) => t.status !== 'done');

  const sortedGroups = taskGroups ? sortTaskGroups(taskGroups, tasksByGroup) : [];
  const tgsDone = sortedGroups.filter((tg) => isAllDone(tasksByGroup.get(tg.id) ?? [])).length;
  const hasContent = sortedGroups.length > 0 || ungroupedTasks.length > 0;

  const milestoneHeader = (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex w-full items-center gap-3 p-3 text-left',
        hasContent && 'cursor-pointer hover:bg-muted',
      )}
    >
      {hasContent && (
        <RiArrowRightSLine
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', {
            'rotate-90': open,
          })}
        />
      )}
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">M{milestone.num}</span>
          {total > 0 && done < total && (
            <span onClick={(e) => e.stopPropagation()}>
              <MilestoneQuickActions milestoneRef={milestone.ref} />
            </span>
          )}
          <span className="text-xs font-medium">{milestone.title}</span>
          <span onClick={(e) => e.stopPropagation()}>
            <MilestoneStatusBadge
              projectId={projectId}
              filename={milestone.filename}
              status={milestone.status}
              clickable
            />
          </span>
        </div>
        {milestone.scope && (
          <p className="text-xs text-muted-foreground line-clamp-1">{milestone.scope}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {sortedGroups.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {tgsDone}/{sortedGroups.length} TGs
          </span>
        )}
        <div className="flex w-32 items-center gap-2">
          <Progress value={pct} className="flex-1" />
          <span className="text-[10px] text-muted-foreground">
            {done}/{total}
          </span>
        </div>
        <span
          role={execSessionId ? 'button' : undefined}
          tabIndex={execSessionId ? 0 : undefined}
          onClick={
            execSessionId
              ? (e) => {
                  e.stopPropagation();
                  setExecDialogOpen(true);
                }
              : undefined
          }
          className={execSessionId ? 'cursor-pointer' : undefined}
        >
          <ExecutionStatusIcon status={execStatus} />
        </span>
      </div>
    </div>
  );

  const milestoneContent = (
    <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
      {groupsLoading && (
        <p className="py-2 text-center text-xs text-muted-foreground">Loading...</p>
      )}
      {sortedGroups.map((tg) => (
        <TaskGroupRow
          key={tg.id}
          taskGroup={tg}
          tasks={tasksByGroup.get(tg.id) ?? []}
          milestoneRef={milestone.ref}
          showDone={showDone}
          onTaskClick={onTaskClick}
          containerEnabled={containerEnabled}
        />
      ))}
      {visibleUngrouped.length > 0 && (
        <div className="flex flex-col">
          <p className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">Other tasks</p>
          {visibleUngrouped.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={onTaskClick ? () => onTaskClick(task.id) : undefined}
            />
          ))}
        </div>
      )}
      {!groupsLoading && sortedGroups.length === 0 && ungroupedTasks.length === 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">No task groups</p>
      )}
    </div>
  );

  const execDialog = execSessionId && (
    <MilestoneExecutionDialog
      milestoneNum={milestone.num}
      milestoneRef={milestone.ref}
      sessionId={execSessionId}
      status={execStatus}
      completionSummary={execSummary}
      open={execDialogOpen}
      onOpenChange={setExecDialogOpen}
    />
  );

  if (!hasContent) {
    return (
      <div className="border border-border">
        {milestoneHeader}
        {execDialog}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border border-border">
        <CollapsibleTrigger asChild>{milestoneHeader}</CollapsibleTrigger>
        <CollapsibleContent>{milestoneContent}</CollapsibleContent>
      </div>
      {execDialog}
    </Collapsible>
  );
}

function TaskGroupRow({
  taskGroup,
  tasks,
  milestoneRef,
  showDone,
  onTaskClick,
  containerEnabled,
}: {
  taskGroup: TaskGroup;
  tasks: Task[];
  milestoneRef: string;
  showDone: boolean;
  onTaskClick?: (taskId: number) => void;
  containerEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { status: tgExecStatus } = useExecutionStatus('taskGroup', taskGroup.id);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const visibleTasks = showDone ? tasks : tasks.filter((t) => t.status !== 'done');
  const allDone = isAllDone(tasks);
  const isCollapsible = visibleTasks.length > 0;

  const activeTask = tgExecStatus === 'active'
    ? tasks.find((t) => t.subStatus === 'implementing' || t.subStatus === 'planning')
    : null;

  const completeBadge = allDone && (
    <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500">
      complete
    </Badge>
  );

  const header = (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
        isCollapsible && 'cursor-pointer hover:bg-muted',
      )}
    >
      {isCollapsible && (
        <RiArrowRightSLine
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', {
            'rotate-90': open,
          })}
        />
      )}
      {total > 0 && done < total && (
        <TaskGroupQuickAction taskGroupId={taskGroup.id} milestoneRef={milestoneRef} />
      )}
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium">{taskGroup.name}</span>
        {activeTask && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <ExecutionStatusIcon status={activeTask.subStatus} className="size-2.5" />
            <span className="truncate">{activeTask.title}</span>
          </span>
        )}
      </div>
      {completeBadge}
      {containerEnabled && tgExecStatus === 'active' && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <RiBox3Line className="size-3 shrink-0 text-blue-500" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Running in container</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {total > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {done}/{total}
        </span>
      )}
      <ExecutionStatusIcon status={tgExecStatus} />
    </div>
  );

  if (!isCollapsible) {
    return <div className="rounded-sm">{header}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-sm">
        <CollapsibleTrigger asChild>{header}</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-5 flex flex-col border-l border-border">
            {visibleTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={onTaskClick ? () => onTaskClick(task.id) : undefined}
              />
            ))}
            {total === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">No tasks</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function TaskGroupQuickAction({
  taskGroupId,
  milestoneRef,
}: {
  taskGroupId: number;
  milestoneRef: string;
}) {
  const { disabled, launch, projectSlug } = useQuickAction();
  const {
    isActive,
    start: startExecution,
    stop: stopExecution,
  } = useExecutionStatus('taskGroup', taskGroupId);

  function handleImplementTaskGroup() {
    launch({
      prompt: `Use /engy:implement-milestone for ${milestoneRef} TG${taskGroupId} in project ${projectSlug}`,
      scopeLabel: `impl-tg: ${milestoneRef} TG${taskGroupId}`,
    });
  }

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              disabled={disabled || isActive}
              onClick={handleImplementTaskGroup}
            >
              <RiHammerLine className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Implement Task Group</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
          >
            <RiMore2Line className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          {isActive ? (
            <DropdownMenuItem onClick={stopExecution}>
              <RiStopLine className="size-4" />
              Stop Execution
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={disabled} onClick={() => startExecution()}>
              <RiPlayLine className="size-4" />
              Execute Task Group
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
