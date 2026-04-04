'use client';

import { useMemo, useState } from 'react';
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
import {
  taskStatusOptions,
  taskStatusLabels,
} from '@/components/projects/task-status-badge';
import { DEFAULT_DONE_LIMIT } from '@/components/projects/task-filter';
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
}: {
  tasks: Task[];
  onTaskClick?: (taskId: number) => void;
  doneLimit?: number;
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingMoves, setPendingMoves] = useState<Record<number, TaskStatus>>({});
  const [backlogExpanded, setBacklogExpanded] = useState(false);

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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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
          />
        ))}
      </div>
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
  headerAction,
}: {
  status: string;
  tasks: Task[];
  sortedDoneTasks: Task[];
  doneLimit: number;
  onTaskClick?: (taskId: number) => void;
  headerAction?: React.ReactNode;
}) {
  const isDone = status === 'done';
  const allItems = isDone ? sortedDoneTasks : tasks.filter((t) => t.status === status);
  const totalCount = allItems.length;
  const items = isDone && doneLimit > 0 ? allItems.slice(0, doneLimit) : allItems;
  const hiddenCount = totalCount - items.length;

  return (
    <DroppableZone id={status} className="flex min-h-0 flex-col gap-2 bg-background p-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${statusDotColors[status]}`} />
        <span className="text-xs font-medium text-muted-foreground">
          {taskStatusLabels[status]}
        </span>
        <span className="text-xs text-muted-foreground/60">{totalCount}</span>
        {headerAction}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {items.map((task) => (
          <DraggableTaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick?.(task.id)}
            className="rounded-none border border-border"
          />
        ))}
        {hiddenCount > 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground">+{hiddenCount} more</p>
        )}
        {items.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No tasks</p>
        )}
      </div>
    </DroppableZone>
  );
}
