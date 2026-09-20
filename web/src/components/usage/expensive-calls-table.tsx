'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, formatTokens } from './format';
import { SortHead } from './sort-head';
import type { UsageExpensiveCallRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type ExpensiveCallSortKey = 'tool' | 'costCents' | 'tokens';

const ACCESSORS = {
  tool: (row: UsageExpensiveCallRow) => row.tool,
  costCents: (row: UsageExpensiveCallRow) => row.costCents,
  tokens: (row: UsageExpensiveCallRow) => row.tokens,
} as const;

export function ExpensiveCallsTable({
  rows,
  onSelectSession,
}: {
  rows: UsageExpensiveCallRow[];
  onSelectSession: (sessionId: string) => void;
}) {
  const { sorted, sort, toggle } = useSortedRows<UsageExpensiveCallRow, ExpensiveCallSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No expensive calls in this date range.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead
            label="Tool"
            active={sort.key === 'tool'}
            direction={sort.direction}
            onClick={() => toggle('tool')}
          />
          <TableHead>Preview</TableHead>
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
          <TableRow
            key={`${row.date}-${row.sessionId}-${row.callIndex}`}
            onClick={() => onSelectSession(row.sessionId)}
            className="cursor-pointer"
          >
            <TableCell className="max-w-[10rem] truncate font-mono">{row.tool}</TableCell>
            <TableCell className="max-w-[24rem] truncate font-mono text-muted-foreground" title={row.preview}>
              {row.preview}
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
