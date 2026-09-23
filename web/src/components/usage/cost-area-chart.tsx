'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
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

function BucketSwatch({ bucket, className }: { bucket: CostBucket; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2.5 shrink-0', className)}
      style={{ backgroundColor: COST_BUCKET_COLOR[bucket] }}
    />
  );
}

function TooltipRow({ bucket, value }: { bucket: CostBucket; value: number }) {
  return (
    <>
      <BucketSwatch bucket={bucket} className="mt-0.5" />
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{COST_BUCKET_LABEL[bucket]}</span>
        <span className="font-mono font-medium text-foreground tabular-nums">
          {formatMoney(value)}
        </span>
      </div>
    </>
  );
}

function CostLegend() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
      {COST_BUCKETS.map((bucket) => (
        <li key={bucket} className="flex items-center gap-1.5 text-muted-foreground">
          <BucketSwatch bucket={bucket} />
          {COST_BUCKET_LABEL[bucket]}
        </li>
      ))}
    </ul>
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
    <div className="flex flex-col gap-3">
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
        </AreaChart>
      </ChartContainer>
      <CostLegend />
    </div>
  );
}
