'use client';

import { SUBAGENT_COLOR, MAGNITUDE_COLOR } from './chart-palette';
import { formatMoney, formatMoneyCompact, share } from './format';

export function CostSplitCell({
  totalCents,
  subagentCents,
}: {
  totalCents: number;
  subagentCents: number;
}) {
  const subagentPct = Math.min(share(subagentCents, totalCents), 1) * 100;

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="tabular-nums">{formatMoney(totalCents)}</span>
      {subagentCents > 0 && (
        <>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMoneyCompact(subagentCents)} in subagents
          </span>
          <div className="flex h-1 w-20 gap-px" aria-hidden>
            <div style={{ width: `${subagentPct}%`, backgroundColor: SUBAGENT_COLOR }} />
            <div style={{ width: `${100 - subagentPct}%`, backgroundColor: MAGNITUDE_COLOR }} />
          </div>
        </>
      )}
    </div>
  );
}
