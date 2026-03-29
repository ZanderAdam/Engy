'use client';

import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

export function DroppableZone({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/20')}
    >
      {children}
    </div>
  );
}
