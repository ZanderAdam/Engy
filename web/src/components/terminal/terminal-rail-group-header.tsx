'use client';

import type { DragEvent } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import type { RailDropZone } from './rail-drop';
import type { TerminalRailGroup } from './types';

export interface RailDropHandlers {
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export function RailDropLine({ zone }: { zone: RailDropZone | undefined }) {
  if (zone !== 'before' && zone !== 'after') return null;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary',
        zone === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

interface TerminalRailGroupHeaderProps {
  group: TerminalRailGroup;
  count: number;
  collapsed: boolean;
  editing: boolean;
  dropZone: RailDropZone | undefined;
  dropHandlers: RailDropHandlers;
  onToggle: () => void;
  onStartRename: () => void;
  onRename: (name: string | null) => void;
}

export function TerminalRailGroupHeader({
  group,
  count,
  collapsed,
  editing,
  dropZone,
  dropHandlers,
  onToggle,
  onStartRename,
  onRename,
}: TerminalRailGroupHeaderProps) {
  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;
  return (
    <div
      {...dropHandlers}
      className={cn(
        'relative flex items-center gap-1 rounded-sm pr-2 text-[11px] font-medium text-muted-foreground hover:bg-muted',
        (dropZone === 'into' || dropZone === 'after') && 'ring-1 ring-inset ring-primary',
      )}
    >
      <RailDropLine zone={dropZone === 'before' ? 'before' : undefined} />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${group.name}`}
        className="flex shrink-0 items-center rounded-sm p-0.5 hover:text-foreground"
      >
        <Chevron className="size-3.5" />
      </button>
      {editing ? (
        <input
          className="min-w-0 flex-1 rounded-sm border border-border bg-transparent px-1 py-0.5 text-[11px] outline-none"
          defaultValue={group.name}
          autoFocus
          aria-label="Group name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(e.currentTarget.value);
            else if (e.key === 'Escape') onRename(null);
          }}
          onBlur={(e) => onRename(e.currentTarget.value)}
        />
      ) : (
        <span
          onDoubleClick={onStartRename}
          title="Double-click to rename"
          className="min-w-0 flex-1 truncate py-1"
        >
          {group.name}
        </span>
      )}
      <span className="shrink-0 tabular-nums">{count}</span>
    </div>
  );
}
