'use client';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatMoney, formatMoneyPrecise, formatTokens } from './format';
import { SortHead } from './sort-head';
import type { UsageToolRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type ToolSortKey = 'tool' | 'calls' | 'costCents' | 'costPerCallCents' | 'resultTokens' | 'errors';

const ACCESSORS = {
  tool: (row: UsageToolRow) => row.tool,
  calls: (row: UsageToolRow) => row.calls,
  costCents: (row: UsageToolRow) => row.costCents,
  costPerCallCents: (row: UsageToolRow) => row.costPerCallCents,
  resultTokens: (row: UsageToolRow) => row.resultTokens,
  errors: (row: UsageToolRow) => row.errors,
} as const;

export function ToolTable({ rows }: { rows: UsageToolRow[] }) {
  const { sorted, sort, toggle } = useSortedRows<UsageToolRow, ToolSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No tool calls in this range.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {(
            [
              ['tool', 'Tool', false],
              ['costCents', 'Cost', true],
              ['costPerCallCents', 'Cost / call', true],
              ['calls', 'Calls', true],
              ['resultTokens', 'Result tokens', true],
              ['errors', 'Errors', true],
            ] as Array<[ToolSortKey, string, boolean]>
          ).map(([key, label, numeric]) => (
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
          <TableRow key={row.tool}>
            <TableCell className="max-w-[16rem] truncate font-mono">{row.tool}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.costCents)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoneyPrecise(row.costPerCallCents)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.calls)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatTokens(row.resultTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {row.errors > 0 ? formatCount(row.errors) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
