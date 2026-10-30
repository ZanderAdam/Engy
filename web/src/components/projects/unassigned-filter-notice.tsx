'use client';

import { Button } from '@/components/ui/button';
import { applyTaskFilters, type TaskFilters } from '@/components/projects/task-filter';

type FilterableTask = Parameters<typeof applyTaskFilters>[0][number];

export function countHiddenByUnassignedOnly(tasks: FilterableTask[], filters: TaskFilters): number {
  if (!filters.unassignedOnly) return 0;
  const shown = applyTaskFilters(tasks, filters).length;
  const shownWithoutUnassigned = applyTaskFilters(tasks, {
    ...filters,
    unassignedOnly: false,
  }).length;
  return shownWithoutUnassigned - shown;
}

export function UnassignedFilterNotice({
  hiddenCount,
  onShowAll,
}: {
  hiddenCount: number;
  onShowAll: () => void;
}) {
  if (hiddenCount === 0) return null;
  const noun = hiddenCount === 1 ? 'task' : 'tasks';
  return (
    <div
      role="status"
      className="flex items-center gap-2 border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span>
        Showing only tasks without a group or milestone. {hiddenCount} {noun} hidden.
      </span>
      <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onShowAll}>
        Show all
      </Button>
    </div>
  );
}
