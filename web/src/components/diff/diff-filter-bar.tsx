'use client';

import { RiSearchLine, RiChat3Line, RiEyeOffLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toggleStatus } from './file-filters';
import type { FilterState, MatchMode } from './file-filters';
import type { GitFileStatus } from './types';

const STATUS_ORDER: GitFileStatus[] = ['added', 'modified', 'deleted', 'renamed'];

const STATUS_STYLE: Record<GitFileStatus, { active: string; idle: string; sigil: string; label: string }> = {
  added: {
    active: 'bg-green-500/20 text-green-400',
    idle: 'text-green-500 hover:bg-green-500/10',
    sigil: '+',
    label: 'Added',
  },
  modified: {
    active: 'bg-blue-500/20 text-blue-400',
    idle: 'text-blue-500 hover:bg-blue-500/10',
    sigil: '~',
    label: 'Modified',
  },
  deleted: {
    active: 'bg-red-500/20 text-red-400',
    idle: 'text-red-500 hover:bg-red-500/10',
    sigil: '-',
    label: 'Deleted',
  },
  renamed: {
    active: 'bg-yellow-500/20 text-yellow-400',
    idle: 'text-yellow-500 hover:bg-yellow-500/10',
    sigil: 'R',
    label: 'Renamed',
  },
};

const MODE_TOGGLES: Array<{ mode: Exclude<MatchMode, 'substring'>; glyph: string; hint: string }> = [
  { mode: 'regex', glyph: '.*', hint: 'Use regular expression' },
  { mode: 'glob', glyph: '**', hint: 'Use glob pattern (e.g. **/*.test.ts)' },
];

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  hint: string;
  className?: string;
  children: React.ReactNode;
}

function ToggleButton({ active, onClick, hint, className, children }: ToggleButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex h-5 shrink-0 items-center gap-0.5 px-1 font-mono text-[10px] transition-colors',
            active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

interface DiffFilterBarProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  statusCounts: Record<GitFileStatus, number>;
  commentedCount: number;
  unviewedCount: number;
  viewedTrackingEnabled: boolean;
  queryError?: string;
}

export function DiffFilterBar({
  filter,
  onFilterChange,
  statusCounts,
  commentedCount,
  unviewedCount,
  viewedTrackingEnabled,
  queryError,
}: DiffFilterBarProps) {
  const setMode = (mode: Exclude<MatchMode, 'substring'>) => {
    onFilterChange({
      ...filter,
      matchMode: filter.matchMode === mode ? 'substring' : mode,
    });
  };

  const toggleStatusFilter = (status: GitFileStatus) => {
    onFilterChange({ ...filter, statuses: toggleStatus(filter.statuses, status) });
  };

  const visibleStatuses = STATUS_ORDER.filter(
    (status) => statusCounts[status] > 0 || filter.statuses.has(status),
  );

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <RiSearchLine className="size-3 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={filter.query}
          onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
          placeholder={filter.matchMode === 'glob' ? '**/*.ts' : 'Filter files...'}
          className={cn(
            'h-5 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none',
            queryError && 'text-destructive',
          )}
        />
        <ToggleButton
          active={filter.matchCase}
          onClick={() => onFilterChange({ ...filter, matchCase: !filter.matchCase })}
          hint="Match case"
        >
          Aa
        </ToggleButton>
        {MODE_TOGGLES.map(({ mode, glyph, hint }) => (
          <ToggleButton
            key={mode}
            active={filter.matchMode === mode}
            onClick={() => setMode(mode)}
            hint={hint}
          >
            {glyph}
          </ToggleButton>
        ))}
      </div>

      {queryError && (
        <div className="px-2 pb-1 text-[10px] text-destructive">
          Invalid {filter.matchMode}: {queryError}
        </div>
      )}

      {(visibleStatuses.length > 0 || commentedCount > 0 || viewedTrackingEnabled) && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
          {visibleStatuses.map((status) => {
            const style = STATUS_STYLE[status];
            const active = filter.statuses.has(status);
            return (
              <ToggleButton
                key={status}
                active={active}
                onClick={() => toggleStatusFilter(status)}
                hint={`${style.label} only`}
                className={active ? style.active : style.idle}
              >
                {style.sigil}
                {statusCounts[status]}
              </ToggleButton>
            );
          })}
          {commentedCount > 0 && (
            <ToggleButton
              active={filter.commentedOnly}
              onClick={() => onFilterChange({ ...filter, commentedOnly: !filter.commentedOnly })}
              hint="Files with comments only"
              className={filter.commentedOnly ? 'bg-amber-500/20 text-amber-400' : 'text-amber-500 hover:bg-amber-500/10'}
            >
              <RiChat3Line className="size-3" />
              {commentedCount}
            </ToggleButton>
          )}
          {viewedTrackingEnabled && (
            <ToggleButton
              active={filter.unviewedOnly}
              onClick={() => onFilterChange({ ...filter, unviewedOnly: !filter.unviewedOnly })}
              hint="Unviewed files only"
            >
              <RiEyeOffLine className="size-3" />
              {unviewedCount}
            </ToggleButton>
          )}
        </div>
      )}
    </div>
  );
}
