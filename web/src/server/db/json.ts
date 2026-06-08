import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * WHERE EXISTS check for membership in a top-level JSON array column.
 * e.g. `json_each(tags) WHERE value = ?`
 */
export function jsonArrayContains(col: AnyColumn, value: string | number): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ${value})`;
}

/**
 * WHERE EXISTS check for membership in a JSON array nested inside a JSON object column.
 * e.g. `json_each(data, '$.field') WHERE value = ?`
 */
export function jsonObjectArrayContains(col: AnyColumn, field: string, value: string | number): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${col}, '$.' || ${field}) WHERE value = ${value})`;
}
