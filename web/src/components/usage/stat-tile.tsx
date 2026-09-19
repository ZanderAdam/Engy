'use client';

import { RiArrowDownLine, RiArrowUpLine, RiSubtractLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { formatDelta, type Delta } from './format';

const DIRECTION_ICON = {
  up: RiArrowUpLine,
  down: RiArrowDownLine,
  flat: RiSubtractLine,
} as const;

interface StatTileProps {
  label: string;
  value: string;
  detail?: string;
  accent?: string;
  emphasis?: boolean;
  delta?: Delta | null;
  deltaLabel?: string;
  /** Rising spend is bad, so the arrow direction and the colour disagree here. */
  upIsGood?: boolean;
}

function DeltaRow({
  delta,
  deltaLabel,
  upIsGood,
}: {
  delta: Delta;
  deltaLabel?: string;
  upIsGood: boolean;
}) {
  const Icon = DIRECTION_ICON[delta.direction];
  const good = delta.direction === 'flat' ? null : (delta.direction === 'up') === upIsGood;

  return (
    <div className="flex items-center gap-1 text-xs">
      <Icon
        className={cn(
          'size-3',
          good === null && 'text-muted-foreground',
          good === true && 'text-[#0ca30c]',
          good === false && 'text-[#d03b3b]',
        )}
      />
      <span className="text-foreground tabular-nums">{formatDelta(delta)}</span>
      {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  detail,
  accent,
  emphasis = false,
  delta,
  deltaLabel,
  upIsGood = false,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border border-border px-4 py-3',
        emphasis && 'bg-muted/30',
      )}
    >
      <div className="flex items-center gap-1.5">
        {accent && (
          <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: accent }} />
        )}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={cn('font-medium leading-tight', emphasis ? 'text-3xl' : 'text-2xl')}>
        {value}
      </span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      {delta && <DeltaRow delta={delta} deltaLabel={deltaLabel} upIsGood={upIsGood} />}
    </div>
  );
}
