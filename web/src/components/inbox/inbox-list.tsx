'use client';

import { useEffect, useRef } from 'react';
import { RiTimeLine } from '@remixicon/react';
import { ciStatusClassName, ciStatusLabel, formatRelativeTime } from '@/components/prs/pr-helpers';
import { cn } from '@/lib/utils';
import type { GhPrCiStatus } from '@engy/common';
import { InboxRiskBadge } from './inbox-risk-badge';
import { prKey, summarizeLatestEvent, type InboxItem } from './inbox-helpers';

interface InboxListProps {
  items: InboxItem[];
  selectedId: number | null;
  ciByPr: Map<string, GhPrCiStatus>;
  onSelect: (id: number) => void;
}

interface InboxRowProps {
  item: InboxItem;
  selected: boolean;
  ci: GhPrCiStatus | undefined;
  onSelect: (id: number) => void;
}

function InboxRow({ item, selected, ci, onSelect }: InboxRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      ref={ref}
      data-testid="inbox-row"
      data-selected={selected}
      onClick={() => onSelect(item.id)}
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 border-b border-border px-3 py-2 transition-colors hover:bg-muted/40',
        selected && 'bg-muted',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-label={item.unread ? 'Unread' : 'Read'}
          className={cn(
            'size-2 shrink-0 rounded-full',
            item.unread ? 'bg-sky-400' : 'bg-transparent',
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            item.unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {item.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(item.lastEventAt)}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-4 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono">
          {item.repoFullName}#{item.prNumber}
        </span>
        <span className="min-w-0 flex-1 truncate">{summarizeLatestEvent(item.latestEvent)}</span>
        {item.snoozedUntil && (
          <span className="flex shrink-0 items-center gap-0.5" title="Snoozed">
            <RiTimeLine className="size-3" />
            Snoozed
          </span>
        )}
        <InboxRiskBadge risk={item.risk} />
        {ci && (
          <span
            className={cn(
              'shrink-0 border px-1.5 py-px text-[10px] font-medium',
              ciStatusClassName(ci),
            )}
          >
            CI {ciStatusLabel(ci).toLowerCase()}
          </span>
        )}
      </div>
    </div>
  );
}

export function InboxList({ items, selectedId, ciByPr, onSelect }: InboxListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {items.map((item) => (
        <InboxRow
          key={item.id}
          item={item}
          selected={item.id === selectedId}
          ci={ciByPr.get(prKey(item.repoFullName, item.prNumber))}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
