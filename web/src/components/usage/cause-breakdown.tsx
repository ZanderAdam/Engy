'use client';

import { MAGNITUDE_COLOR } from './chart-palette';
import { formatPercent, share } from './format';
import type { UsageCauses } from './types';

const CAUSE_LABEL: Record<keyof UsageCauses, string> = {
  baseline: 'Baseline context',
  toolResult: 'Tool results',
  toolInput: 'Tool call inputs',
  text: 'Assistant text',
  image: 'Images',
  thinking: 'Thinking',
};

const CAUSE_ORDER: Array<keyof UsageCauses> = [
  'baseline',
  'toolResult',
  'toolInput',
  'text',
  'image',
  'thinking',
];

const CAUSE_HINT: Record<keyof UsageCauses, string> = {
  baseline: 'System prompt, tool definitions and CLAUDE.md — re-read on every call, attributable to no single tool',
  toolResult: 'What tools returned into context',
  toolInput: 'What the model wrote into tool calls',
  text: 'Assistant prose',
  image: 'Screenshots and other images',
  thinking: 'Reasoning blocks',
};

export function CauseBreakdown({ causes }: { causes: UsageCauses }) {
  const total = CAUSE_ORDER.reduce((sum, key) => sum + causes[key], 0);
  const rows = CAUSE_ORDER.map((key) => ({
    key,
    label: CAUSE_LABEL[key],
    hint: CAUSE_HINT[key],
    fraction: share(causes[key], total),
  })).sort((a, b) => b.fraction - a.fraction);

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No attributed content in this range.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground" title={row.hint}>
            {row.label}
          </span>
          <div className="h-2.5 bg-muted">
            <div
              className="h-full"
              style={{
                width: `${Math.max(row.fraction * 100, row.fraction > 0 ? 1 : 0)}%`,
                backgroundColor: MAGNITUDE_COLOR,
              }}
            />
          </div>
          <span className="text-right tabular-nums text-foreground">
            {formatPercent(row.fraction)}
          </span>
        </div>
      ))}
    </div>
  );
}
