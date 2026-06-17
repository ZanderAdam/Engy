import { and, eq, isNull, max } from 'drizzle-orm';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { taskGroups } from '../db/schema';

type AnyDb = BaseSQLiteDatabase<'sync', unknown, Record<string, unknown>>;

/**
 * Returns the next numInMilestone value for a new task group within the
 * (projectId, milestoneRef) bucket. Starts at 1 for an empty bucket.
 */
export function nextNumInMilestone(
  db: AnyDb,
  projectId: number | null | undefined,
  milestoneRef: string | null | undefined,
): number {
  const projectCondition =
    projectId != null ? eq(taskGroups.projectId, projectId) : isNull(taskGroups.projectId);
  const milestoneCondition =
    milestoneRef != null
      ? eq(taskGroups.milestoneRef, milestoneRef)
      : isNull(taskGroups.milestoneRef);

  const result = db
    .select({ maxNum: max(taskGroups.numInMilestone) })
    .from(taskGroups)
    .where(and(projectCondition, milestoneCondition))
    .get();

  return (result?.maxNum ?? 0) + 1;
}
