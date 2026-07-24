'use client';

import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

export function DroppableZone({
  id,
  children,
  className,
  quadrant,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  /** Styling hook rendered as data-quadrant (used by the eisenhower matrix). */
  quadrant?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      data-quadrant={quadrant}
      className={cn(className, isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/20')}
    >
      {children}
    </div>
  );
}
