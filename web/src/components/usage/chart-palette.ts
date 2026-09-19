import type { ChartConfig } from '@/components/ui/chart';

/**
 * Dark-surface steps from the validated categorical palette, kept in the
 * documented slot order: adjacency is what clears the CVD gate, so reordering
 * or substituting a hue invalidates the check
 * (`node scripts/validate_palette.js --mode dark --surface "#18181b"`).
 */
export const COST_BUCKETS = ['cacheRead', 'cacheWrite', 'output', 'input'] as const;

export type CostBucket = (typeof COST_BUCKETS)[number];

export const COST_BUCKET_COLOR: Record<CostBucket, string> = {
  cacheRead: '#3987e5',
  cacheWrite: '#d95926',
  output: '#199e70',
  input: '#c98500',
};

export const COST_BUCKET_LABEL: Record<CostBucket, string> = {
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  output: 'Output',
  input: 'Input',
};

export const COST_CHART_CONFIG: ChartConfig = Object.fromEntries(
  COST_BUCKETS.map((bucket) => [
    bucket,
    { label: COST_BUCKET_LABEL[bucket], color: COST_BUCKET_COLOR[bucket] },
  ]),
);

/** Single-measure magnitude marks stay neutral so no hue impersonates a cost bucket. */
export const MAGNITUDE_COLOR = '#a1a1aa';

/** Reserved for the delegated/direct split wherever it appears. */
export const DELEGATED_COLOR = '#d55181';
