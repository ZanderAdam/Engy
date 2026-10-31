'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  taskStatusColors,
  taskStatusIcons,
  taskStatusLabels,
  taskStatusOptions,
} from '@/components/projects/task-status-badge';
import type { TaskStatus } from '@/lib/task-status';
import {
  RiCheckDoubleLine,
  RiCircleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFlagLine,
  RiFolderLine,
  RiHammerLine,
  RiLoopRightLine,
  RiPlayLine,
} from '@remixicon/react';

interface BulkActionBarProps {
  selectedCount: number;
  allVisibleSelected: boolean;
  canCopy: boolean;
  canChangeStatus: boolean;
  canImplement: boolean;
  missingPlanSlugs: string;
  onSelectAll: () => void;
  onGroup: () => void;
  onMilestone: () => void;
  onDelete: () => void;
  onExecute: () => void;
  onCopyIds: () => void;
  onChangeStatus: (status: TaskStatus) => void;
  onImplement: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  selectedCount,
  allVisibleSelected,
  canCopy,
  canChangeStatus,
  canImplement,
  missingPlanSlugs,
  onSelectAll,
  onGroup,
  onMilestone,
  onDelete,
  onExecute,
  onCopyIds,
  onChangeStatus,
  onImplement,
  onCancel,
}: BulkActionBarProps) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-none border border-border bg-muted/50 px-3 py-1.5">
      <Badge variant="secondary" className="text-xs">
        {selectedCount} selected
      </Badge>

      <Button variant="ghost" size="sm" onClick={onSelectAll} className="text-xs">
        <RiCheckDoubleLine data-icon="inline-start" />
        {allVisibleSelected ? 'Deselect All' : 'Select All'}
      </Button>

      <div className="mx-1 h-4 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!canChangeStatus} className="text-xs">
            <RiLoopRightLine data-icon="inline-start" />
            Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {taskStatusOptions.map((status) => {
            const StatusIcon = taskStatusIcons[status] ?? RiCircleLine;
            return (
              <DropdownMenuItem
                key={status}
                className={taskStatusColors[status]}
                onClick={() => onChangeStatus(status)}
              >
                <StatusIcon className="size-4" />
                {taskStatusLabels[status]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="sm"
        onClick={onGroup}
        disabled={!hasSelection}
        className="text-xs"
      >
        <RiFolderLine data-icon="inline-start" />
        Group
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onMilestone}
        disabled={!hasSelection}
        className="text-xs"
      >
        <RiFlagLine data-icon="inline-start" />
        Milestone
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!hasSelection}
        className="text-xs text-destructive hover:text-destructive"
      >
        <RiDeleteBinLine data-icon="inline-start" />
        Delete
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onExecute}
        disabled={!hasSelection}
        className="text-xs"
      >
        <RiPlayLine data-icon="inline-start" />
        Execute
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onCopyIds}
        disabled={!canCopy}
        className="text-xs"
      >
        <RiFileCopyLine data-icon="inline-start" />
        Copy IDs
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onImplement}
        disabled={!canImplement}
        className="text-xs"
      >
        <RiHammerLine data-icon="inline-start" />
        Implement in terminal
      </Button>

      {missingPlanSlugs && (
        <span className="text-xs text-amber-400">Needs a plan first: {missingPlanSlugs}</span>
      )}

      <div className="ml-auto">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs">
          <RiCloseLine data-icon="inline-start" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
