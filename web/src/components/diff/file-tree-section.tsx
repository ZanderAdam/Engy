'use client';

import { RiArrowRightSLine, RiArrowDownSLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

interface FileTreeSectionProps {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Share of the pane to take. Grow factors across the expanded sections must
   * sum to 1: a lone item growing by less than 1 claims only that proportion of
   * the free space, leaving the rest of the pane blank.
   */
  grow: number;
  children: React.ReactNode;
}

/**
 * One titled, collapsible half of the file list. Collapsed it shrinks to its
 * header so the other half takes the freed height; expanded it scrolls on its
 * own, so a long list on one side never pushes the other off screen.
 */
export function FileTreeSection({
  title,
  count,
  expanded,
  onToggle,
  grow,
  children,
}: FileTreeSectionProps) {
  const empty = count === 0;

  return (
    <div
      className="flex min-h-0 flex-col"
      style={expanded ? { flex: `${grow} 1 0%` } : { flex: 'none' }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={empty}
        aria-expanded={expanded}
        className={cn(
          'flex w-full shrink-0 items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider',
          'text-muted-foreground/60',
          empty ? 'cursor-default' : 'cursor-pointer hover:text-foreground',
        )}
      >
        {expanded ? (
          <RiArrowDownSLine className="size-3 shrink-0" />
        ) : (
          <RiArrowRightSLine className="size-3 shrink-0" />
        )}
        <span>{title}</span>
        <span className="ml-auto tabular-nums">{count}</span>
      </button>

      {expanded && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
    </div>
  );
}
