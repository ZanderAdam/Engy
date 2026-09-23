'use client';

import type { UsageCacheEfficiency } from './types';

export function CacheTtlPanel({ efficiency }: { efficiency: UsageCacheEfficiency }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-3xl font-medium leading-none tabular-nums">
        {efficiency.readsPerWrite.toFixed(2)}×
      </span>
      <span className="text-xs text-muted-foreground">
        tokens read from cache for each token written
      </span>
    </div>
  );
}
