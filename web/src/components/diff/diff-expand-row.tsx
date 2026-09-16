'use client';

import { Decoration, getCollapsedLinesCountBetween } from 'react-diff-view';
import type { HunkData } from 'react-diff-view';
import { RiExpandUpDownLine } from '@remixicon/react';

interface DiffExpandRowProps {
  /** Null for the gap above the first hunk. */
  previousHunk: HunkData | null;
  nextHunk: HunkData;
  onExpand: (start: number, end: number) => void;
}

/**
 * The clickable "N hidden lines" row between two hunks. Expansion ranges are in
 * the original file's line numbering, which is what `expandFromRawCode` slices.
 */
export function DiffExpandRow({ previousHunk, nextHunk, onExpand }: DiffExpandRowProps) {
  const hidden = getCollapsedLinesCountBetween(previousHunk, nextHunk);
  if (hidden <= 0) return null;

  const start = previousHunk ? previousHunk.oldStart + previousHunk.oldLines : 1;

  return (
    <Decoration className="diff-expand-row">
      <button
        type="button"
        onClick={() => onExpand(start, nextHunk.oldStart)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <RiExpandUpDownLine className="size-3.5 shrink-0" />
        Expand {hidden} hidden {hidden === 1 ? 'line' : 'lines'}
      </button>
    </Decoration>
  );
}
