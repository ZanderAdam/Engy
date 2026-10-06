import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

export function startsWithPrefix(column: AnyColumn, prefix: string): SQL {
  return sql`substr(${column}, 1, length(${prefix})) = ${prefix}`;
}
