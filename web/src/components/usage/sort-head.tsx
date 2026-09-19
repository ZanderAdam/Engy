'use client';

import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SortDirection } from './use-sorted-rows';

interface SortHeadProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  numeric?: boolean;
  onClick: () => void;
  className?: string;
}

export function SortHead({
  label,
  active,
  direction,
  numeric = false,
  onClick,
  className,
}: SortHeadProps) {
  const Icon = direction === 'asc' ? RiArrowUpSLine : RiArrowDownSLine;

  return (
    <TableHead
      className={cn(numeric && 'text-right', className)}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-0.5 cursor-pointer transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground',
          numeric && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('size-3', !active && 'opacity-0')} />
      </button>
    </TableHead>
  );
}
