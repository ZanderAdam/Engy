'use client';

import { RiArrowLeftLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { ContextGrowthChart } from './context-growth-chart';
import { FieldTable } from './field-table';
import { FileTable } from './file-table';
import { formatCount, formatMoney, formatMoneyCompact, formatPercent, share } from './format';
import { EstimateNotice, Panel } from './panel';
import { StatTile } from './stat-tile';
import { SubagentTable } from './subagent-table';
import { ToolTable } from './tool-table';
import type { UsageSessionDetail } from './types';

interface SessionDetailProps {
  detail: UsageSessionDetail;
  onBack: () => void;
}

export function SessionDetail({ detail, onBack }: SessionDetailProps) {
  const { session, tools, files, fields, subagents, callSeries } = detail;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="xs" className="w-fit" onClick={onBack}>
          <RiArrowLeftLine className="size-3" />
          All sessions
        </Button>
        <div>
          <h2 className="text-sm font-medium">{session.label}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {session.repoRoot ?? session.slug} · {session.model}
            {session.startedAt ? ` · ${session.startedAt.slice(0, 10)}` : ''}
          </p>
        </div>
      </div>

      <EstimateNotice />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total cost"
          value={formatMoneyCompact(session.costCents)}
          detail="This session and its subagents"
        />
        <StatTile
          label="Subagent share"
          value={formatPercent(share(session.subagentCostCents, session.costCents))}
          detail={`${formatMoney(session.subagentCostCents)} · ${formatCount(session.subagentCalls)} calls`}
        />
        <StatTile
          label="API calls"
          value={formatCount(session.apiCalls)}
          detail={`${session.readsPerWrite.toFixed(2)}× cache reads per write`}
        />
        <StatTile
          label="Lines changed"
          value={formatCount((session.linesAdded ?? 0) + (session.linesRemoved ?? 0))}
          detail={`+${formatCount(session.linesAdded ?? 0)} / −${formatCount(session.linesRemoved ?? 0)}`}
        />
      </div>

      <Panel title="Context size">
        <ContextGrowthChart series={callSeries} />
      </Panel>

      <Panel title="Subagents">
        <SubagentTable rows={subagents} />
      </Panel>

      <Panel title="Tools">
        <ToolTable rows={tools} />
      </Panel>

      <Panel title="Tool input fields">
        <FieldTable rows={fields} />
      </Panel>

      <Panel title="Files">
        <FileTable rows={files} groupBy="path" />
      </Panel>
    </div>
  );
}
