'use client';

import { DELEGATED_COLOR, MAGNITUDE_COLOR } from './chart-palette';
import { formatMoneyCompact, formatPercent } from './format';

interface DelegationSplitProps {
  totalCents: number;
  subagentCents: number;
  subagentShare: number;
}

export function DelegationSplit({
  totalCents,
  subagentCents,
  subagentShare,
}: DelegationSplitProps) {
  const directCents = Math.max(totalCents - subagentCents, 0);
  const delegatedPct = Math.min(Math.max(subagentShare, 0), 1) * 100;

  return (
    <div className="flex flex-col gap-3 border border-border px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-medium leading-none">{formatPercent(subagentShare)}</span>
          <span className="text-xs text-muted-foreground">of the cost comes from subagents</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatMoneyCompact(subagentCents)} subagents · {formatMoneyCompact(directCents)} main
          session
        </span>
      </div>

      <div className="flex h-3 w-full gap-0.5">
        <div style={{ width: `${delegatedPct}%`, backgroundColor: DELEGATED_COLOR }} aria-hidden />
        <div
          style={{ width: `${100 - delegatedPct}%`, backgroundColor: MAGNITUDE_COLOR }}
          aria-hidden
        />
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2" style={{ backgroundColor: DELEGATED_COLOR }} />
          Subagents
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2" style={{ backgroundColor: MAGNITUDE_COLOR }} />
          Main session
        </span>
      </div>
    </div>
  );
}
