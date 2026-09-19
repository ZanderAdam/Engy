import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export type SortAccessors<T, K extends string> = Record<K, (row: T) => number | string>;

export function compareRows<T, K extends string>(
  accessors: SortAccessors<T, K>,
  sort: SortState<K>,
): (a: T, b: T) => number {
  const read = accessors[sort.key];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const left = read(a);
    const right = read(b);
    if (typeof left === 'string' || typeof right === 'string') {
      return sign * String(left).localeCompare(String(right));
    }
    return sign * (left - right);
  };
}

/** Numeric columns lead with the biggest value; text columns lead A→Z. */
function defaultDirection<T, K extends string>(
  accessors: SortAccessors<T, K>,
  rows: T[],
  key: K,
): SortDirection {
  const sample = rows.length > 0 ? accessors[key](rows[0]) : 0;
  return typeof sample === 'string' ? 'asc' : 'desc';
}

export function useSortedRows<T, K extends string>(
  rows: T[],
  accessors: SortAccessors<T, K>,
  initialKey: K,
) {
  const [sort, setSort] = useState<SortState<K>>({ key: initialKey, direction: 'desc' });

  const sorted = useMemo(
    () => [...rows].sort(compareRows(accessors, sort)),
    [rows, accessors, sort],
  );

  function toggle(key: K) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultDirection(accessors, rows, key) },
    );
  }

  return { sorted, sort, toggle };
}
