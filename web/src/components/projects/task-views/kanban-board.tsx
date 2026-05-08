'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { RiArrowRightSLine } from '@remixicon/react';
import { TaskCard } from '@/components/projects/task-card';
import { DraggableTaskCard } from '@/components/projects/task-views/draggable-task-card';
import { DroppableZone } from '@/components/projects/task-views/droppable-zone';
import { CollapsedLaneStrip } from '@/components/projects/task-views/collapsed-lane-strip';
import {
  taskStatusOptions,
  taskStatusLabels,
} from '@/components/projects/task-status-badge';
import { DEFAULT_DONE_LIMIT } from '@/components/projects/task-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { Task } from '@/components/projects/types';
import type { TaskStatus } from '@/lib/task-status';

const statusDotColors: Record<string, string> = {
  backlog: 'bg-zinc-500',
  todo: 'bg-muted-foreground',
  in_progress: 'bg-blue-500',
  review: 'bg-yellow-500',
  done: 'bg-green-500',
};

export function KanbanBoard({
  tasks,
  onTaskClick,
  doneLimit = DEFAULT_DONE_LIMIT,
  selectable = false,
  selectedIds,
  onTaskSelect,
}: {
  tasks: Task[];
  onTaskClick?: (taskId: number) => void;
  doneLimit?: number;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onTaskSelect?: (id: number) => void;
}) {
  const isMobile = useIsMobile();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingMoves, setPendingMoves] = useState<Record<number, TaskStatus>>({});
  const [backlogExpanded, setBacklogExpanded] = useState(false);

  const [expandedStatus, setExpandedStatus] = useState<TaskStatus>(() => {
    const priority: TaskStatus[] = ['in_progress', 'todo', 'review', 'done', 'backlog'];
    return priority.find((s) => tasks.some((t) => t.status === s)) ?? 'todo';
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onError: () => {
      toast.error('Failed to move task');
    },
    onSettled: (_data, _err, variables) => {
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      utils.task.list.invalidate();
      utils.task.get.invalidate();
    },
  });

  const effectiveTasks = useMemo(
    () =>
      tasks.map((t) => {
        const pending = pendingMoves[t.id];
        return pending ? { ...t, status: pending } : t;
      }),
    [tasks, pendingMoves],
  );

  const sortedDoneTasks = useMemo(() => {
    const doneTasks = effectiveTasks.filter((t) => t.status === 'done');
    return doneTasks.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [effectiveTasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveTask((event.active.data.current as { task: Task })?.task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const task = (active.data.current as { task: Task })?.task;
    if (!task) return;
    const newStatus = over.id as TaskStatus;
    const currentStatus = pendingMoves[task.id] ?? task.status;
    if (currentStatus === newStatus) return;

    setPendingMoves((prev) => ({ ...prev, [task.id]: newStatus }));
    updateTask.mutate({ id: task.id, status: newStatus });
  }

  const backlogCount = effectiveTasks.filter((t) => t.status === 'backlog').length;
  const visibleStatuses = taskStatusOptions.filter(
    (s) => s !== 'backlog' && !(backlogExpanded && s === 'done'),
  );

  const mobileStatusOrder: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {isMobile ? (
        <div className="flex min-h-0 flex-1 flex-col gap-px bg-border">
          {mobileStatusOrder.map((status) => {
            const count = effectiveTasks.filter((t) => t.status === status).length;
            if (expandedStatus === status) {
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={effectiveTasks}
                  sortedDoneTasks={sortedDoneTasks}
                  doneLimit={doneLimit}
                  onTaskClick={onTaskClick}
                  selectable={selectable}
                  selectedIds={selectedIds}
                  onTaskSelect={onTaskSelect}
                  flex1
                />
              );
            }
            return (
              <CollapsedLaneStrip
                key={status}
                droppableId={status}
                label={taskStatusLabels[status]}
                count={count}
                dotColorClass={statusDotColors[status]}
                onExpand={() => setExpandedStatus(status)}
              />
            );
          })}
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-px bg-border"
          style={{
            gridTemplateColumns: backlogExpanded
              ? `repeat(${visibleStatuses.length + 1}, minmax(0, 1fr))`
              : `auto repeat(${visibleStatuses.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Backlog column — collapsed by default */}
          {backlogExpanded ? (
            <KanbanColumn
              status="backlog"
              tasks={effectiveTasks}
              sortedDoneTasks={sortedDoneTasks}
              doneLimit={doneLimit}
              onTaskClick={onTaskClick}
              selectable={selectable}
              selectedIds={selectedIds}
              onTaskSelect={onTaskSelect}
              headerAction={
                <button
                  type="button"
                  onClick={() => setBacklogExpanded(false)}
                  className="ml-auto text-muted-foreground/60 hover:text-muted-foreground"
                >
                  <RiArrowRightSLine className="size-4 rotate-180" />
                </button>
              }
            />
          ) : (
            <DroppableZone
              id="backlog"
              className="flex min-h-0 flex-col items-center bg-background py-3"
            >
              <button
                type="button"
                onClick={() => setBacklogExpanded(true)}
                className="flex shrink-0 flex-col items-center gap-1 text-muted-foreground/60 hover:text-muted-foreground"
              >
                <span className="text-xs font-medium">{backlogCount}</span>
                <RiArrowRightSLine className="size-3.5" />
                <span className="text-[10px] font-medium tracking-wider [writing-mode:vertical-lr]">
                  Backlog
                </span>
              </button>
            </DroppableZone>
          )}

          {/* Regular columns — Done is hidden when Backlog is expanded */}
          {visibleStatuses.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={effectiveTasks}
              sortedDoneTasks={sortedDoneTasks}
              doneLimit={doneLimit}
              onTaskClick={onTaskClick}
              selectable={selectable}
              selectedIds={selectedIds}
              onTaskSelect={onTaskSelect}
            />
          ))}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <TaskCard task={activeTask} className="rounded-none border border-border shadow-lg" />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  tasks,
  sortedDoneTasks,
  doneLimit,
  onTaskClick,
  selectable = false,
  selectedIds,
  onTaskSelect,
  headerAction,
  flex1 = false,
}: {
  status: string;
  tasks: Task[];
  sortedDoneTasks: Task[];
  doneLimit: number;
  onTaskClick?: (taskId: number) => void;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onTaskSelect?: (id: number) => void;
  headerAction?: React.ReactNode;
  flex1?: boolean;
}) {
  const isDone = status === 'done';
  const allItems = isDone ? sortedDoneTasks : tasks.filter((t) => t.status === status);
  const totalCount = allItems.length;
  const items = isDone && doneLimit > 0 ? allItems.slice(0, doneLimit) : allItems;
  const hiddenCount = totalCount - items.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function updateOverflow() {
      if (!el) return;
      const top = el.scrollTop > 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setOverflow({ top, bottom });
    }

    updateOverflow();
    el.addEventListener('scroll', updateOverflow);

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', updateOverflow);
      observer.disconnect();
    };
  }, [items.length, hiddenCount]);

  return (
    <DroppableZone
      id={status}
      className={`flex min-h-0 flex-col gap-2 bg-background p-3${flex1 ? ' flex-1' : ''}`}
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${statusDotColors[status]}`} />
        <span className="text-xs font-medium text-muted-foreground">
          {taskStatusLabels[status]}
        </span>
        <span className="text-xs text-muted-foreground/60">{totalCount}</span>
        {headerAction}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
        >
          {items.map((task) => (
            <DraggableTaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick?.(task.id)}
              className="rounded-none border border-border"
              selectable={selectable}
              selected={selectedIds?.has(task.id)}
              onSelect={onTaskSelect}
            />
          ))}
          {hiddenCount > 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">+{hiddenCount} more</p>
          )}
          {items.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No tasks</p>
          )}
        </div>
        {overflow.top && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background to-transparent"
          />
        )}
        {overflow.bottom && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
    </DroppableZone>
  );
}
