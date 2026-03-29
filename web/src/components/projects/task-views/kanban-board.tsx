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
import { TaskCard } from '@/components/projects/task-card';
import { DraggableTaskCard } from '@/components/projects/task-views/draggable-task-card';
import { DroppableZone } from '@/components/projects/task-views/droppable-zone';
import { taskStatusOptions } from '@/components/projects/task-status-badge';
import { DEFAULT_DONE_LIMIT } from '@/components/projects/task-filter';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { Task } from '@/components/projects/types';

type TaskStatus = (typeof taskStatusOptions)[number];

const statusLabels: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

const statusDotColors: Record<string, string> = {
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="grid min-h-0 flex-1 gap-px bg-border"
        style={{ gridTemplateColumns: `repeat(${taskStatusOptions.length}, minmax(0, 1fr))` }}
      >
        {taskStatusOptions.map((status) => {
          const isDone = status === 'done';
          const allItems = isDone
            ? sortedDoneTasks
            : effectiveTasks.filter((t) => t.status === status);
          const totalCount = allItems.length;
          const items = isDone && doneLimit > 0 ? allItems.slice(0, doneLimit) : allItems;
          const hiddenCount = totalCount - items.length;

          return (
            <DroppableZone
              key={status}
              id={status}
              className="flex min-h-0 flex-col gap-2 bg-background p-3"
            >
              <div className="flex shrink-0 items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${statusDotColors[status]}`} />
                <span className="text-xs font-medium text-muted-foreground">
                  {statusLabels[status]}
                </span>
                <span className="text-xs text-muted-foreground/60">{totalCount}</span>
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
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    +{hiddenCount} more
                  </p>
                )}
                {items.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No tasks</p>
                )}
              </div>
            </DroppableZone>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <TaskCard task={activeTask} className="rounded-none border border-border shadow-lg" />
        )}
      </DragOverlay>
    </DndContext>
  );
}
