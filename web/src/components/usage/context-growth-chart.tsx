'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { COST_BUCKET_COLOR } from './chart-palette';
import { formatCount, formatTokens } from './format';
import type { UsageCallSeriesPoint } from './types';

export function ContextGrowthChart({ series }: { series: UsageCallSeriesPoint[] }) {
  if (series.length === 0) {
    return <p className="text-xs text-muted-foreground">No API calls recorded for this session.</p>;
  }

  return (
    <ChartContainer
      config={{ cacheReadTokens: { label: 'Cache read', color: COST_BUCKET_COLOR.cacheRead } }}
      className="aspect-auto h-56 w-full"
    >
      <LineChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="callIndex"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value: number) => formatCount(value)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value: number) => formatTokens(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => `Call ${payload?.[0]?.payload?.callIndex ?? ''}`}
              formatter={(value) => (
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {formatTokens(Number(value))} cache-read tokens
                </span>
              )}
            />
          }
        />
        <Line
          dataKey="cacheReadTokens"
          type="monotone"
          stroke={COST_BUCKET_COLOR.cacheRead}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
