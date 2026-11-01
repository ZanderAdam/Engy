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
import { KanbanLaneContent } from '@/components/projects/task-views/kanban-lane-content';
import { CollapsedLaneStrip } from '@/components/projects/task-views/collapsed-lane-strip';
import { CollapsedLaneRail } from '@/components/projects/task-views/collapsed-lane-rail';
import { laneCollapsed } from '@/components/projects/task-views/kanban-collapse';
import { taskStatusLabels } from '@/components/projects/task-status-badge';
import { DEFAULT_DONE_LIMIT } from '@/components/projects/task-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { Task } from '@/components/projects/types';
import {
  KANBAN_LANES,
  kanbanLaneOf,
  statusAfterLaneDrop,
  type KanbanLane,
} from '@/lib/task-status';

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
  const [pendingMoves, setPendingMoves] = useState<Record<number, KanbanLane>>({});
  const [collapseOverrides, setCollapseOverrides] = useState<Partial<Record<KanbanLane, boolean>>>(
    {},
  );

  const [expandedStatus, setExpandedStatus] = useState<KanbanLane>(() => {
    const priority: KanbanLane[] = ['in_progress', 'todo', 'review', 'done', 'backlog'];
    return priority.find((s) => tasks.some((t) => kanbanLaneOf(t.status) === s)) ?? 'todo';
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation({
    onError: () => {
      toast.error('Failed to move task');
    },
    onSettled: async (_data, _err, variables) => {
      await Promise.all([utils.task.list.invalidate(), utils.task.get.invalidate()]);
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
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
    const doneTasks = effectiveTasks.filter((t) => kanbanLaneOf(t.status) === 'done');
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
    const newStatus = statusAfterLaneDrop(
      pendingMoves[task.id] ?? task.status,
      over.id as KanbanLane,
    );
    if (!newStatus) return;

    setPendingMoves((prev) => ({ ...prev, [task.id]: newStatus }));
    updateTask.mutate({ id: task.id, status: newStatus });
  }

  const hasAnyTasks = effectiveTasks.length > 0;
  const laneCount = (status: KanbanLane) =>
    effectiveTasks.filter((t) => kanbanLaneOf(t.status) === status).length;
  const isCollapsed = (status: KanbanLane) =>
    laneCollapsed(status, laneCount(status), collapseOverrides[status], hasAnyTasks);
  const toggleLane = (status: KanbanLane) =>
    setCollapseOverrides((prev) => ({
      ...prev,
      [status]: !laneCollapsed(status, laneCount(status), prev[status], hasAnyTasks),
    }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {isMobile ? (
        <div className="flex min-h-0 flex-1 flex-col gap-px bg-border">
          {KANBAN_LANES.map((status) => {
            const count = laneCount(status);
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
            gridTemplateColumns: KANBAN_LANES.map((status) =>
              isCollapsed(status) ? 'auto' : 'minmax(0, 1fr)',
            ).join(' '),
          }}
        >
          {KANBAN_LANES.map((status) =>
            isCollapsed(status) ? (
              <CollapsedLaneRail
                key={status}
                droppableId={status}
                label={taskStatusLabels[status]}
                count={laneCount(status)}
                onExpand={() => toggleLane(status)}
              />
            ) : (
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
                headerAction={
                  <button
                    type="button"
                    onClick={() => toggleLane(status)}
                    className="ml-auto text-muted-foreground/60 hover:text-muted-foreground"
                  >
                    <RiArrowRightSLine className="size-4 rotate-180" />
                  </button>
                }
              />
            ),
          )}
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

  return (
    <DroppableZone
      id={status}
      className={`flex min-h-0 flex-col gap-2 bg-background p-3${flex1 ? ' flex-1' : ''}`}
    >
      <KanbanLaneContent
        dotColorClass={statusDotColors[status]}
        label={taskStatusLabels[status]}
        count={totalCount}
        remeasureKey={`${items.length}:${hiddenCount}`}
        headerAction={headerAction}
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
      </KanbanLaneContent>
    </DroppableZone>
  );
}
