'use client';

import { MAGNITUDE_COLOR } from './chart-palette';
import { formatPercent, share } from './format';
import type { UsageCauses } from './types';

const CAUSE_LABEL: Record<keyof UsageCauses, string> = {
  baseline: 'System prompt and tools',
  toolResult: 'Tool results',
  toolInput: 'Tool inputs',
  text: 'Replies',
  image: 'Images',
  thinking: 'Thinking',
  attachment: 'Injected context',
};

const CAUSE_ORDER: Array<keyof UsageCauses> = [
  'baseline',
  'toolResult',
  'toolInput',
  'text',
  'image',
  'thinking',
  'attachment',
];

const CAUSE_HINT: Record<keyof UsageCauses, string> = {
  baseline:
    'The system prompt, tool definitions and root CLAUDE.md files. Every API call sends these again.',
  toolResult: 'Data that tools returned to Claude.',
  toolInput: 'Text Claude wrote into tool calls.',
  text: 'Text Claude wrote in its replies.',
  image: 'Images in the conversation.',
  thinking: 'Tokens Claude used to think before it replied.',
  attachment:
    'Context that Claude Code adds, for example skill lists, CLAUDE.md files and hook output.',
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
    return <p className="text-xs text-muted-foreground">No content in this date range.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[11rem_1fr_3rem] items-center gap-2 text-xs">
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
