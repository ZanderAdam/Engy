'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatMoney, formatTokens } from './format';
import { SortHead } from './sort-head';
import type { FileGroupBy, UsageFileRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type FileSortKey = 'key' | 'reads' | 'edits' | 'writes' | 'tokens' | 'costCents';

const ACCESSORS = {
  key: (row: UsageFileRow) => row.key,
  reads: (row: UsageFileRow) => row.reads,
  edits: (row: UsageFileRow) => row.edits,
  writes: (row: UsageFileRow) => row.writes,
  tokens: (row: UsageFileRow) => row.tokens,
  costCents: (row: UsageFileRow) => row.costCents,
} as const;

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '—';
}

export function FileTable({ rows, groupBy }: { rows: UsageFileRow[]; groupBy: FileGroupBy }) {
  const { sorted, sort, toggle } = useSortedRows<UsageFileRow, FileSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No file activity in this range.</p>;
  }

  const keyLabel = groupBy === 'ext' ? 'Extension' : groupBy === 'dir' ? 'Directory' : 'Path';

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead
            label={keyLabel}
            active={sort.key === 'key'}
            direction={sort.direction}
            onClick={() => toggle('key')}
          />
          {groupBy === 'path' && <TableHead>Ext</TableHead>}
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
          <SortHead
            label="Reads"
            numeric
            active={sort.key === 'reads'}
            direction={sort.direction}
            onClick={() => toggle('reads')}
          />
          <SortHead
            label="Edits"
            numeric
            active={sort.key === 'edits'}
            direction={sort.direction}
            onClick={() => toggle('edits')}
          />
          <SortHead
            label="Writes"
            numeric
            active={sort.key === 'writes'}
            direction={sort.direction}
            onClick={() => toggle('writes')}
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="max-w-[24rem] truncate font-mono" title={row.key}>
              {row.key}
            </TableCell>
            {groupBy === 'path' && (
              <TableCell className="font-mono text-muted-foreground">
                {extensionOf(row.key)}
              </TableCell>
            )}
            <TableCell className="text-right tabular-nums">{formatMoney(row.costCents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatTokens(row.tokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.reads)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.edits)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.writes)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
