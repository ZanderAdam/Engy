import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { permanentMemories } from '../db/schema';

/**
 * Return the set of filePaths for permanent memories that have been superseded.
 * These rows are logically dead and must be excluded from all result sets.
 */
export function getSupersededMemoryPaths(workspaceId: number): Set<string> {
  const db = getDb();
  const rows = db
    .select({ filePath: permanentMemories.filePath })
    .from(permanentMemories)
    .where(and(eq(permanentMemories.workspaceId, workspaceId), isNotNull(permanentMemories.supersededById)))
    .all();
  return new Set(rows.map((r) => r.filePath).filter((p): p is string => p !== null));
}
