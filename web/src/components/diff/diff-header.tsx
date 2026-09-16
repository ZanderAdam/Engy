'use client';

import { RiCheckboxLine, RiCheckboxBlankLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GitFileStatus, ViewMode } from './types';

const statusConfig: Record<GitFileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'bg-green-500/15 text-green-500 border-green-500/30' },
  modified: { letter: 'M', className: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  deleted: { letter: 'D', className: 'bg-red-500/15 text-red-500 border-red-500/30' },
  renamed: { letter: 'R', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
};

export function DiffHeader({
  filePath,
  status,
  viewMode,
  onViewModeChange,
  hideViewModeToggle,
  isViewed,
  onToggleViewed,
}: {
  filePath: string;
  status: GitFileStatus;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  hideViewModeToggle?: boolean;
  isViewed?: boolean;
  onToggleViewed?: () => void;
}) {
  const { letter, className } = statusConfig[status];

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center border text-[10px] font-bold',
          className,
        )}
      >
        {letter}
      </span>

      <span className="truncate font-mono text-xs text-foreground">{filePath}</span>

      <div className="ml-auto flex items-center gap-2">
        {onToggleViewed && (
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={!!isViewed}
            onClick={onToggleViewed}
            className={cn('gap-1.5', isViewed && 'text-primary')}
          >
            {isViewed ? (
              <RiCheckboxLine className="size-3.5" />
            ) : (
              <RiCheckboxBlankLine className="size-3.5" />
            )}
            Viewed
          </Button>
        )}

        {!hideViewModeToggle && (
          <div className="flex">
            <Button
              variant="ghost"
              size="xs"
              className={cn(viewMode === 'split' && 'bg-muted text-foreground')}
              onClick={() => onViewModeChange('split')}
            >
              Split
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className={cn(viewMode === 'unified' && 'bg-muted text-foreground')}
              onClick={() => onViewModeChange('unified')}
            >
              Unified
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
