'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { MAGNITUDE_COLOR } from './chart-palette';
import { formatAxisMoney, formatMoney, formatMoneyCompact } from './format';
import type { UsageGroup } from './types';

const MAX_BARS = 12;

interface BarDatum {
  label: string;
  tick: string;
  cost: number;
}

/** Repo roots and slugs are long; the axis shows the tail, the tooltip the whole thing. */
function tickLabel(label: string): string {
  const segments = label.split(/[/-]/).filter(Boolean);
  return segments.length <= 2 ? label : `…${segments.slice(-2).join('/')}`;
}

function foldTail(groups: UsageGroup[]): BarDatum[] {
  const sorted = [...groups].sort((a, b) => b.cost - a.cost);
  const head = sorted.slice(0, MAX_BARS).map((g) => ({
    label: g.label,
    tick: tickLabel(g.label),
    cost: g.cost,
  }));
  const tail = sorted.slice(MAX_BARS);
  if (tail.length === 0) return head;
  const other = `Other (${tail.length})`;
  return [...head, { label: other, tick: other, cost: tail.reduce((s, g) => s + g.cost, 0) }];
}

export function ProjectBarChart({ groups }: { groups: UsageGroup[] }) {
  const data = useMemo(() => foldTail(groups), [groups]);

  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-xs text-muted-foreground">
        No projects in this date range.
      </p>
    );
  }

  return (
    <ChartContainer
      config={{ cost: { label: 'Cost', color: MAGNITUDE_COLOR } }}
      className="aspect-auto w-full"
      style={{ height: `${Math.max(data.length * 28 + 32, 160)}px` }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 56, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatAxisMoney(value)}
        />
        <YAxis
          type="category"
          dataKey="tick"
          tickLine={false}
          axisLine={false}
          width={140}
          tickMargin={6}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.label ?? ''}
              formatter={(value) => (
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {formatMoney(Number(value))}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="cost" fill={MAGNITUDE_COLOR} barSize={16} isAnimationActive={false}>
          <LabelList
            dataKey="cost"
            position="right"
            offset={8}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(value) => formatMoneyCompact(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
