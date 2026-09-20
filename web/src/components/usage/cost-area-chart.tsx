'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  COST_BUCKETS,
  COST_BUCKET_COLOR,
  COST_BUCKET_LABEL,
  COST_CHART_CONFIG,
  type CostBucket,
} from './chart-palette';
import { formatAxisMoney, formatMoney } from './format';
import type { UsageSeriesPoint } from './types';

function shortDate(date: string): string {
  return date.slice(5);
}

function TooltipRow({ bucket, value }: { bucket: CostBucket; value: number }) {
  return (
    <>
      <span
        aria-hidden
        className="mt-0.5 size-2.5 shrink-0"
        style={{ backgroundColor: COST_BUCKET_COLOR[bucket] }}
      />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{COST_BUCKET_LABEL[bucket]}</span>
        <span className="font-mono font-medium text-foreground tabular-nums">
          {formatMoney(value)}
        </span>
      </div>
    </>
  );
}

export function CostAreaChart({ series }: { series: UsageSeriesPoint[] }) {
  if (series.length === 0) {
    return (
      <p className="py-16 text-center text-xs text-muted-foreground">
        No usage in this date range.
      </p>
    );
  }

  return (
    <ChartContainer config={COST_CHART_CONFIG} className="aspect-auto h-64 w-full">
      <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={shortDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatAxisMoney(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? ''}
              formatter={(value, name) => (
                <TooltipRow bucket={name as CostBucket} value={Number(value)} />
              )}
            />
          }
        />
        {COST_BUCKETS.map((bucket) => (
          <Area
            key={bucket}
            dataKey={bucket}
            type="monotone"
            stackId="cost"
            fill={COST_BUCKET_COLOR[bucket]}
            fillOpacity={1}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
