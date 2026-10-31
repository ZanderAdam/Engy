'use client';

import { RiArrowRightSLine } from '@remixicon/react';
import { OptionalDroppableZone } from '@/components/projects/task-views/droppable-zone';

export function CollapsedLaneRail({
  droppableId,
  label,
  count,
  onExpand,
}: {
  droppableId?: string;
  label: string;
  count: number;
  onExpand: () => void;
}) {
  return (
    <OptionalDroppableZone
      id={droppableId}
      className="flex min-h-0 flex-col items-center bg-background py-3"
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex shrink-0 flex-col items-center gap-1 text-muted-foreground/60 hover:text-muted-foreground"
      >
        <span className="text-xs font-medium">{count}</span>
        <RiArrowRightSLine className="size-3.5" />
        <span className="text-[10px] font-medium tracking-wider [writing-mode:vertical-lr]">
          {label}
        </span>
      </button>
    </OptionalDroppableZone>
  );
}
