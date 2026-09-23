'use client';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatMoney, formatTokens } from './format';
import { SortHead } from './sort-head';
import type { UsageContextItemRow } from './types';
import { useSortedRows } from './use-sorted-rows';

type ContextItemSortKey = 'kind' | 'item' | 'costCents' | 'tokens' | 'count';

const KIND_LABEL: Record<string, string> = {
  skill_listing: 'Skill list',
  agent_listing_delta: 'Agent list',
  invoked_skills: 'Loaded skills',
  nested_memory: 'CLAUDE.md',
  file: 'Mentioned file',
  edited_text_file: 'Edited file',
  hook_success: 'Hook output',
  deferred_tools_delta: 'Deferred tools',
  queued_command: 'Queued prompt',
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? 'Other';
}

function itemLabel(row: UsageContextItemRow): string {
  if (row.label) return row.label;
  return row.kind in KIND_LABEL ? '—' : row.kind;
}

const ACCESSORS = {
  kind: (row: UsageContextItemRow) => kindLabel(row.kind),
  item: (row: UsageContextItemRow) => itemLabel(row),
  costCents: (row: UsageContextItemRow) => row.costCents,
  tokens: (row: UsageContextItemRow) => row.tokens,
  count: (row: UsageContextItemRow) => row.count,
} as const;

const COLUMNS: Array<[ContextItemSortKey, string, boolean]> = [
  ['kind', 'Kind', false],
  ['item', 'Item', false],
  ['costCents', 'Cost', true],
  ['tokens', 'Tokens', true],
  ['count', 'Count', true],
];

export function ContextItemTable({ rows }: { rows: UsageContextItemRow[] }) {
  const { sorted, sort, toggle } = useSortedRows<UsageContextItemRow, ContextItemSortKey>(
    rows,
    ACCESSORS,
    'costCents',
  );

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No injected context in this date range.</p>;
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
          <TableRow key={`${row.kind}\u0000${row.label}`}>
            <TableCell className="whitespace-nowrap">{kindLabel(row.kind)}</TableCell>
            <TableCell className="max-w-[24rem] truncate font-mono" title={itemLabel(row)}>
              {itemLabel(row)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.costCents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatTokens(row.tokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCount(row.count)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
