import { ne } from 'drizzle-orm';
import type { UsageReducerVersion } from '@engy/common';
import { getDb, type Db } from '../db/client';
import { usageScanFile, usageSealedDate } from '../db/schema';

/**
 * Bump this, `UsageReducerVersion` in common and the daemon's copy when the
 * attribution model or token estimate changes. A sealed date carries the
 * version it was sealed under, so a mismatch makes the next refresh re-read
 * every transcript on disk.
 */
export const USAGE_REDUCER_VERSION: UsageReducerVersion = 4;

/**
 * Makes the next scan read every transcript on disk in full, which replaces
 * each of those sessions' rows. Rollup rows stay: Claude Code deletes old
 * transcripts, so a session whose file is gone cannot be derived again.
 */
export function rebuildUsageHistory(db: Db = getDb()): void {
  db.transaction((tx) => {
    tx.delete(usageScanFile).run();
    tx.delete(usageSealedDate).run();
  });
}

export function hasStaleReducerSeals(db: Db = getDb()): boolean {
  const stale = db
    .select({ date: usageSealedDate.date })
    .from(usageSealedDate)
    .where(ne(usageSealedDate.reducerVersion, USAGE_REDUCER_VERSION))
    .get();
  return stale !== undefined;
}
