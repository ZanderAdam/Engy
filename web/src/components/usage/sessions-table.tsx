'use client';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { CostSplitCell } from './cost-split-cell';
import { formatCount, formatDuration } from './format';
import { SortHead } from './sort-head';
import type { UsageSessionRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type SessionSortKey = 'label' | 'startedAt' | 'duration' | 'apiCalls' | 'model' | 'costCents';

const ACCESSORS = {
  label: (row: UsageSessionRow) => row.label,
  startedAt: (row: UsageSessionRow) => row.startedAt ?? '',
  duration: (row: UsageSessionRow) => row.durationMinutes ?? 0,
  apiCalls: (row: UsageSessionRow) => row.apiCalls,
  model: (row: UsageSessionRow) => row.model,
  costCents: (row: UsageSessionRow) => row.costCents,
} as const;

const COLUMNS: Array<[SessionSortKey, string, boolean]> = [
  ['label', 'Session', false],
  ['costCents', 'Cost', true],
  ['duration', 'Duration', true],
  ['apiCalls', 'API calls', true],
  ['model', 'Model', false],
];

export function SessionsTable({
  rows,
  onSelect,
}: {
  rows: UsageSessionRow[];
  onSelect: (sessionId: string) => void;
}) {
  const { sorted, sort, toggle } = useSortedRows<UsageSessionRow, SessionSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No sessions in this range.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS.map(([key, label, numeric]) => (
            <SortHead
              key={key}
              label={label}
              numeric={numeric}
              active={sort.key === key}
              direction={sort.direction}
              onClick={() => toggle(key)}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow
            key={row.sessionId}
            onClick={() => onSelect(row.sessionId)}
            className="cursor-pointer"
          >
            <TableCell className="max-w-[28rem]">
              <span className="block truncate" title={row.label}>
                {row.label}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {row.repoRoot ?? row.slug}
                {row.startedAt ? ` · ${row.startedAt.slice(0, 10)}` : ''}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <CostSplitCell totalCents={row.costCents} subagentCents={row.subagentCostCents} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.durationMinutes ? formatDuration(row.durationMinutes) : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.apiCalls)}
              {row.subagentCalls > 0 && (
                <span className="block text-xs">+{formatCount(row.subagentCalls)} delegated</span>
              )}
            </TableCell>
            <TableCell className="font-mono text-muted-foreground">{row.model}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
