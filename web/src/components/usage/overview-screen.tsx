'use client';

import { RiAlertLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { CacheTtlPanel } from './cache-ttl-panel';
import { CauseBreakdown } from './cause-breakdown';
import { COST_BUCKET_COLOR } from './chart-palette';
import { CostAreaChart } from './cost-area-chart';
import { DelegationSplit } from './delegation-split';
import {
  computeDelta,
  formatCount,
  formatMoneyCompact,
  formatPercent,
  formatTokens,
  share,
} from './format';
import { EstimateNotice, Panel } from './panel';
import { ProjectBarChart } from './project-bar-chart';
import { StatTile } from './stat-tile';
import type { GroupAxis, UsageOverview, UsageSessionRow } from './types';

interface OverviewScreenProps {
  overview: UsageOverview;
  sessions: UsageSessionRow[];
  groupAxis: GroupAxis;
  onGroupAxisChange: (axis: GroupAxis) => void;
  previousLabel: string;
  onSelectSession: (sessionId: string) => void;
}

function UnpricedWarning({ models }: { models: string[] }) {
  return (
    <div className="flex items-start gap-3 border border-[#fab219]/25 bg-[#fab219]/5 px-4 py-3 text-xs">
      <RiAlertLine className="mt-0.5 size-4 shrink-0 text-[#fab219]" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          {models.length} unpriced {models.length === 1 ? 'model' : 'models'}
        </p>
        <p className="text-muted-foreground">
          Tokens for <span className="font-mono">{models.join(', ')}</span> are counted. No list
          price is on file for them. Totals below are lower than the real cost.
        </p>
      </div>
    </div>
  );
}

function AxisToggle({ axis, onChange }: { axis: GroupAxis; onChange: (axis: GroupAxis) => void }) {
  const options: Array<{ value: GroupAxis; label: string }> = [
    { value: 'repo', label: 'Repo' },
    { value: 'slug', label: 'Slug' },
  ];

  return (
    <div className="flex items-center border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'cursor-pointer px-2 py-0.5 text-xs transition-colors',
            axis === option.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function OverviewScreen({
  overview,
  sessions,
  groupAxis,
  onGroupAxisChange,
  previousLabel,
  onSelectSession,
}: OverviewScreenProps) {
  const { cost, totals, previous, causes, cacheEfficiency, series, groups } = overview;
  const cacheWriteTokens = totals.cacheWrite1hTokens + totals.cacheWrite5mTokens;

  return (
    <div className="flex flex-col gap-4">
      <EstimateNotice />

      {overview.unpricedModels.length > 0 && <UnpricedWarning models={overview.unpricedModels} />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cache read"
          value={formatPercent(share(cost.cacheRead, cost.total))}
          detail={`${formatMoneyCompact(cost.cacheRead)} · ${formatTokens(totals.cacheReadTokens)} tokens`}
          accent={COST_BUCKET_COLOR.cacheRead}
          delta={computeDelta(cost.cacheRead, previous.cacheRead)}
          deltaLabel={previousLabel}
          emphasis
        />
        <StatTile
          label="Cache write"
          value={formatPercent(share(cost.cacheWrite, cost.total))}
          detail={`${formatMoneyCompact(cost.cacheWrite)} · ${formatTokens(cacheWriteTokens)} tokens`}
          accent={COST_BUCKET_COLOR.cacheWrite}
          delta={computeDelta(cost.cacheWrite, previous.cacheWrite)}
          deltaLabel={previousLabel}
          emphasis
        />
        <StatTile
          label="Total cost"
          value={formatMoneyCompact(cost.total)}
          detail={`${formatCount(totals.apiCalls)} API calls · ${formatCount(totals.sessions)} sessions`}
          delta={computeDelta(cost.total, previous.total)}
          deltaLabel={previousLabel}
        />
        <StatTile
          label="Output"
          value={formatPercent(share(cost.output, cost.total))}
          detail={`${formatMoneyCompact(cost.output)} · ${formatTokens(totals.thinkingTokens)} thinking tokens`}
          accent={COST_BUCKET_COLOR.output}
          delta={computeDelta(cost.output, previous.output)}
          deltaLabel={previousLabel}
        />
      </div>

      <DelegationSplit
        totalCents={cost.total}
        subagentCents={cost.subagentCost}
        subagentShare={overview.subagentShare}
      />

      <Panel title="Cost over time">
        <CostAreaChart series={series} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Cost per project"
          action={<AxisToggle axis={groupAxis} onChange={onGroupAxisChange} />}
        >
          <ProjectBarChart groups={groups} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Cache reads per write">
            <CacheTtlPanel
              efficiency={cacheEfficiency}
              sessions={sessions}
              onSelectSession={onSelectSession}
            />
          </Panel>

          <Panel title="Cost causes">
            <CauseBreakdown causes={causes} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
