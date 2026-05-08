'use client';

import { RiArrowRightSLine } from '@remixicon/react';
import { DroppableZone } from '@/components/projects/task-views/droppable-zone';

export function CollapsedLaneStrip({
  droppableId,
  label,
  count,
  dotColorClass,
  onExpand,
}: {
  droppableId: string;
  label: string;
  count: number;
  dotColorClass?: string;
  onExpand: () => void;
}) {
  return (
    <DroppableZone id={droppableId} className="shrink-0 bg-background">
      <button
        type="button"
        onClick={onExpand}
        className="flex h-10 w-full items-center justify-between px-3 text-muted-foreground/60 hover:text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          {dotColorClass && (
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotColorClass}`} />
          )}
          <span className="text-xs font-medium">{label}</span>
          <span className="text-xs text-muted-foreground/60">{count}</span>
        </span>
        <RiArrowRightSLine className="size-4 rotate-90" />
      </button>
    </DroppableZone>
  );
}
