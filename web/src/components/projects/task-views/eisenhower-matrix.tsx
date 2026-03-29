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
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { Task } from '@/components/projects/types';

type Importance = 'important' | 'not_important';
type Urgency = 'urgent' | 'not_urgent';

type Quadrant = {
  label: string;
  importance: Importance;
  urgency: Urgency;
};

const quadrants: Quadrant[] = [
  { label: 'Urgent + Important', importance: 'important', urgency: 'urgent' },
  { label: 'Not Urgent + Important', importance: 'important', urgency: 'not_urgent' },
  { label: 'Urgent + Not Important', importance: 'not_important', urgency: 'urgent' },
  {
    label: 'Not Urgent + Not Important',
    importance: 'not_important',
    urgency: 'not_urgent',
  },
];

type PendingMove = { importance: Importance; urgency: Urgency };

export function EisenhowerMatrix({
  tasks,
  projectSlug,
  onTaskClick,
}: {
  tasks: Task[];
  projectSlug?: string;
  onTaskClick?: (taskId: number) => void;
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingMoves, setPendingMoves] = useState<Record<number, PendingMove>>({});

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
        return pending ? { ...t, importance: pending.importance, urgency: pending.urgency } : t;
      }),
    [tasks, pendingMoves],
  );

  function tasksForQuadrant(q: Quadrant) {
    return effectiveTasks.filter(
      (t) =>
        (t.importance ?? 'not_important') === q.importance &&
        (t.urgency ?? 'not_urgent') === q.urgency,
    );
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTask((event.active.data.current as { task: Task })?.task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const task = (active.data.current as { task: Task })?.task;
    if (!task) return;

    const parts = (over.id as string).split('--');
    if (parts.length !== 2) return;
    const [importance, urgency] = parts as [Importance, Urgency];
    const pending = pendingMoves[task.id];
    const currentImportance = pending?.importance ?? (task.importance ?? 'not_important');
    const currentUrgency = pending?.urgency ?? (task.urgency ?? 'not_urgent');
    if (currentImportance === importance && currentUrgency === urgency) return;

    setPendingMoves((prev) => ({ ...prev, [task.id]: { importance, urgency } }));
    updateTask.mutate({ id: task.id, importance, urgency });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-border">
        {quadrants.map((q) => {
          const items = tasksForQuadrant(q);
          const droppableId = `${q.importance}--${q.urgency}`;
          return (
            <DroppableZone
              key={q.label}
              id={droppableId}
              className="flex min-h-0 flex-col gap-2 bg-background p-3"
            >
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{q.label}</span>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {items.map((task) => (
                  <DraggableTaskCard
                    key={task.id}
                    task={task}
                    projectSlug={projectSlug}
                    onClick={() => onTaskClick?.(task.id)}
                    className="rounded-none border border-border"
                  />
                ))}
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
