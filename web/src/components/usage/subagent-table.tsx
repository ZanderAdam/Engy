'use client';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatMoney } from './format';
import { SortHead } from './sort-head';
import type { UsageSubagentRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type SubagentSortKey = 'agentType' | 'model' | 'apiCalls' | 'costCents';

const ACCESSORS = {
  agentType: (row: UsageSubagentRow) => row.agentType ?? '',
  model: (row: UsageSubagentRow) => row.model,
  apiCalls: (row: UsageSubagentRow) => row.apiCalls,
  costCents: (row: UsageSubagentRow) => row.costCents,
} as const;

const COLUMNS: Array<[SubagentSortKey, string, boolean]> = [
  ['agentType', 'Agent', false],
  ['costCents', 'Cost', true],
  ['apiCalls', 'API calls', true],
  ['model', 'Model', false],
];

export function SubagentTable({ rows }: { rows: UsageSubagentRow[] }) {
  const { sorted, sort, toggle } = useSortedRows<UsageSubagentRow, SubagentSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">This session delegated no work.</p>;
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
          <TableRow key={row.sessionId}>
            <TableCell className="max-w-[28rem]">
              <span className="block font-mono">{row.agentType ?? 'Agent'}</span>
              {row.agentDescription && (
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={row.agentDescription}
                >
                  {row.agentDescription}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.costCents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.apiCalls)}
            </TableCell>
            <TableCell className="font-mono text-muted-foreground">{row.model}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
