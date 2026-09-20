'use client';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { formatMoney, formatTokens } from './format';
import { SortHead } from './sort-head';
import type { UsageFieldRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type FieldSortKey = 'name' | 'costCents' | 'tokens';

const ACCESSORS = {
  name: (row: UsageFieldRow) => `${row.tool}.${row.field}`,
  costCents: (row: UsageFieldRow) => row.costCents,
  tokens: (row: UsageFieldRow) => row.tokens,
} as const;

export function FieldTable({ rows }: { rows: UsageFieldRow[] }) {
  const { sorted, sort, toggle } = useSortedRows<UsageFieldRow, FieldSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No tool input fields in this date range.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead
            label="Tool input field"
            active={sort.key === 'name'}
            direction={sort.direction}
            onClick={() => toggle('name')}
          />
          <SortHead
            label="Cost"
            numeric
            active={sort.key === 'costCents'}
            direction={sort.direction}
            onClick={() => toggle('costCents')}
          />
          <SortHead
            label="Tokens"
            numeric
            active={sort.key === 'tokens'}
            direction={sort.direction}
            onClick={() => toggle('tokens')}
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={`${row.tool}.${row.field}`}>
            <TableCell className="max-w-[20rem] truncate font-mono">
              {row.tool}
              <span className="text-muted-foreground">.{row.field}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.costCents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatTokens(row.tokens)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
