import { inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';
import { broadcastTaskChange } from '../ws/broadcast';
import type { TaskStatus } from '@/lib/task-status';

interface BulkTaskUpdates {
  status?: TaskStatus;
  milestoneRef?: string | null;
  taskGroupId?: number | null;
}

export function bulkUpdateTasks(ids: number[], updates: BulkTaskUpdates): { updated: number } {
  if (ids.length === 0) return { updated: 0 };

  return getDb().transaction((tx) => {
    const result = tx
      .update(tasks)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(inArray(tasks.id, ids))
      .returning()
      .all();

    for (const task of result) {
      broadcastTaskChange('updated', task.id, task.projectId ?? undefined);
    }

    return { updated: result.length };
  });
}

export function bulkDeleteTasks(ids: number[]): { deleted: number } {
  if (ids.length === 0) return { deleted: 0 };

  return getDb().transaction((tx) => {
    const deleted = tx.delete(tasks).where(inArray(tasks.id, ids)).returning().all();

    for (const task of deleted) {
      broadcastTaskChange('deleted', task.id, task.projectId ?? undefined);
    }

    return { deleted: deleted.length };
  });
}
