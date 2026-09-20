import { ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  usageCall,
  usageCause,
  usageExpensiveCall,
  usageField,
  usageFile,
  usageScanFile,
  usageSealedDate,
  usageSession,
  usageSessionDaily,
  usageTool,
} from '../db/schema';

type Db = ReturnType<typeof getDb>;

/**
 * Bump this when the attribution model or token estimate changes. A sealed
 * date carries the version it was sealed under, so a mismatch on the next
 * scan means the stored rollup was computed by logic since replaced and can
 * no longer be trusted.
 */
export const USAGE_REDUCER_VERSION = 1;

/** Leaves `usagePricing` untouched: it is configuration, not history. */
export function rebuildUsageHistory(db: Db = getDb()): void {
  db.transaction((tx) => {
    tx.delete(usageScanFile).run();
    tx.delete(usageSealedDate).run();
    tx.delete(usageSession).run();
    tx.delete(usageSessionDaily).run();
    tx.delete(usageTool).run();
    tx.delete(usageField).run();
    tx.delete(usageFile).run();
    tx.delete(usageCause).run();
    tx.delete(usageCall).run();
    tx.delete(usageExpensiveCall).run();
  });
}

/** Re-seal on a reducer change: a version bump invalidates every seal and
 * forces a full rebuild, so a fixed bug reaches historical data instead of
 * being masked by rows a stale reducer already sealed. */
export function invalidateStaleReducerSeals(db: Db = getDb()): boolean {
  const stale = db
    .select({ date: usageSealedDate.date })
    .from(usageSealedDate)
    .where(ne(usageSealedDate.reducerVersion, USAGE_REDUCER_VERSION))
    .get();
  if (!stale) return false;
  rebuildUsageHistory(db);
  return true;
}
