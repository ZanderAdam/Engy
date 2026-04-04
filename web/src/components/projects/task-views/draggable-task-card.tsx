'use client';

import { useDraggable } from '@dnd-kit/core';
import { TaskCard } from '@/components/projects/task-card';
import { cn } from '@/lib/utils';
import type { Task } from '@/components/projects/types';

export function DraggableTaskCard({
  task,
  onClick,
  className,
  projectSlug,
  selectable,
  selected,
  onSelect,
}: {
  task: Task;
  onClick?: () => void;
  className?: string;
  projectSlug?: string;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(task.id),
    data: { task },
  });

  return (
    <div ref={setNodeRef} className={cn(isDragging && 'opacity-40')}>
      <TaskCard
        task={task}
        onClick={onClick}
        className={className}
        projectSlug={projectSlug}
        selectable={selectable}
        selected={selected}
        onSelect={onSelect}
        dragHandleProps={selectable ? undefined : { ...listeners, ...attributes }}
      />
    </div>
  );
}
