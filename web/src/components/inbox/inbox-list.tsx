'use client';

import { useEffect, useRef } from 'react';
import { RiCheckLine, RiTimeLine, RiZzzLine } from '@remixicon/react';
import { formatRelativeTime } from '@/components/prs/pr-helpers';
import { AttentionBadge } from '@/components/prs/pr-badges';
import { ReviewAvatar } from '@/components/review/review-avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { InboxCiBadge, InboxRiskBadge } from './inbox-badges';
import { formatSnoozeUntil, githubAvatarUrl } from './inbox-helpers';
import type { InboxRowModel } from './inbox-rows';

interface InboxListProps {
  rows: InboxRowModel[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onDone: (row: InboxRowModel) => void;
  onSnooze: (row: InboxRowModel) => void;
}

interface InboxRowProps extends Omit<InboxListProps, 'rows' | 'selectedKey'> {
  row: InboxRowModel;
  selected: boolean;
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InboxRow({ row, selected, onSelect, onDone, onSnooze }: InboxRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const Icon = row.icon;

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-testid="inbox-row"
      data-selected={selected}
      onClick={() => onSelect(row.key)}
      className={cn(
        'group flex cursor-pointer flex-col gap-0.5 border-b border-border px-3 py-2 transition-colors hover:bg-muted/40',
        selected && 'bg-muted',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-label={row.unread ? 'Unread' : 'Read'}
          className={cn(
            'size-2 shrink-0 rounded-full',
            row.unread ? 'bg-sky-400' : 'bg-transparent',
          )}
        />
        <Icon className={cn('size-4 shrink-0', row.iconClassName)} />
        {row.avatarLogin && (
          <ReviewAvatar login={row.avatarLogin} avatarUrl={githubAvatarUrl(row.avatarLogin)} />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            row.unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {row.title}
        </span>
        <span
          className={cn(
            'shrink-0 text-xs text-muted-foreground',
            row.item &&
              'group-hover:hidden group-has-[button:focus-visible]:hidden pointer-coarse:hidden',
            row.item && selected && 'hidden',
          )}
        >
          {formatRelativeTime(row.at)}
        </span>
        {row.item && (
          <span
            className={cn(
              'hidden shrink-0 items-center group-hover:flex group-has-[button:focus-visible]:flex pointer-coarse:flex',
              selected && 'flex',
            )}
          >
            <RowAction label="Snooze (H)" onClick={() => onSnooze(row)}>
              <RiZzzLine />
            </RowAction>
            <RowAction label="Done (E)" onClick={() => onDone(row)}>
              <RiCheckLine />
            </RowAction>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono">
          {row.repoFullName}#{row.prNumber}
        </span>
        <span className="min-w-0 flex-1 truncate">{row.summary}</span>
        {row.snoozedUntil && (
          <span className="flex shrink-0 items-center gap-0.5">
            <RiTimeLine className="size-3" />
            {formatSnoozeUntil(row.snoozedUntil)}
          </span>
        )}
        <AttentionBadge reason={row.pr?.attentionReason ?? null} compact />
        <InboxRiskBadge risk={row.risk} />
        <InboxCiBadge ci={row.ci} />
      </div>
    </div>
  );
}

export function InboxList({ rows, selectedKey, onSelect, onDone, onSnooze }: InboxListProps) {
  return (
    <TooltipProvider>
      <div
        role="listbox"
        aria-label="Inbox"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {rows.map((row) => (
          <InboxRow
            key={row.key}
            row={row}
            selected={row.key === selectedKey}
            onSelect={onSelect}
            onDone={onDone}
            onSnooze={onSnooze}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
