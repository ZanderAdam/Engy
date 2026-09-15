'use client';

import { useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { commentBodyText } from './agent-findings';
import type { DiffComment } from './use-diff-comments';

interface ReviewSummaryPanelProps {
  summary: DiffComment | null;
  findingCount: number;
  onDelete?: (threadId: string) => void;
}

/**
 * The review read before any file. Sits above the stack rather than in a tab so
 * it is on the way to the diff instead of somewhere to navigate to.
 */
export function ReviewSummaryPanel({ summary, findingCount, onDelete }: ReviewSummaryPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!summary) return null;

  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;

  return (
    <div className="border-b border-border bg-muted/20">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-3.5 shrink-0" />
          <RiRobot2Line className="size-3.5 shrink-0" />
          <span className="font-medium">Review summary</span>
        </button>
        <span className="text-[10px] text-muted-foreground/60">
          {findingCount === 0
            ? 'no findings anchored'
            : `${findingCount} finding${findingCount === 1 ? '' : 's'} on the diff`}
        </span>
        {onDelete && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => onDelete(summary.threadId)}
          >
            Delete
          </Button>
        )}
      </div>
      <div
        className={cn(
          'whitespace-pre-wrap px-3 pb-3 pl-9 text-xs text-foreground/90',
          collapsed && 'hidden',
        )}
      >
        {commentBodyText(summary.comments[0]?.body)}
      </div>
    </div>
  );
}
