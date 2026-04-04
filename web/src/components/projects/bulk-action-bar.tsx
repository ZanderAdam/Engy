'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RiCheckDoubleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFlagLine,
  RiFolderLine,
  RiPlayLine,
} from '@remixicon/react';

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onGroup: () => void;
  onMilestone: () => void;
  onDelete: () => void;
  onExecute: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onGroup,
  onMilestone,
  onDelete,
  onExecute,
  onCancel,
}: BulkActionBarProps) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="flex items-center gap-2 rounded-none border border-border bg-muted/50 px-3 py-1.5">
      <Badge variant="secondary" className="text-xs">
        {selectedCount} selected
      </Badge>

      <Button variant="ghost" size="sm" onClick={onSelectAll} className="text-xs">
        <RiCheckDoubleLine data-icon="inline-start" />
        {selectedCount === totalCount ? 'Deselect All' : 'Select All'}
      </Button>

      <div className="mx-1 h-4 w-px bg-border" />

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

      <div className="ml-auto">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs">
          <RiCloseLine data-icon="inline-start" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
