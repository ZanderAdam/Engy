import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { nextNumInMilestone } from './task-group-numbering';
import { taskGroups } from '../db/schema';

describe('nextNumInMilestone', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Use null projectId to avoid FK constraints — the numbering logic is independent of actual project rows.
  function insertTg(
    projectId: number | null,
    milestoneRef: string | null,
    numInMilestone: number,
  ) {
    return ctx.db
      .insert(taskGroups)
      .values({ projectId, milestoneRef, name: `TG-${numInMilestone}`, numInMilestone })
      .returning()
      .get();
  }

  it('should return 1 for an empty bucket', () => {
    expect(nextNumInMilestone(ctx.db, null, 'm1')).toBe(1);
  });

  it('should return max+1 for a non-empty bucket', () => {
    insertTg(null, 'm1', 1);
    insertTg(null, 'm1', 2);
    expect(nextNumInMilestone(ctx.db, null, 'm1')).toBe(3);
  });

  it('should number independently across different milestoneRefs', () => {
    insertTg(null, 'm1', 1);
    insertTg(null, 'm2', 1);
    insertTg(null, 'm2', 2);

    expect(nextNumInMilestone(ctx.db, null, 'm1')).toBe(2);
    expect(nextNumInMilestone(ctx.db, null, 'm2')).toBe(3);
  });

  it('should handle null milestoneRef bucket', () => {
    insertTg(null, null, 1);
    expect(nextNumInMilestone(ctx.db, null, null)).toBe(2);
  });

  it('should handle both null projectId and null milestoneRef bucket', () => {
    insertTg(null, null, 1);
    insertTg(null, null, 2);
    expect(nextNumInMilestone(ctx.db, null, null)).toBe(3);
  });

  it('should return max+1 after deleting highest — gaps allowed, no renumber', () => {
    insertTg(null, 'm1', 1);
    insertTg(null, 'm1', 2);
    const tg3 = insertTg(null, 'm1', 3);

    ctx.db.delete(taskGroups).where(eq(taskGroups.id, tg3.id)).run();

    // max is now 2, next is 3
    expect(nextNumInMilestone(ctx.db, null, 'm1')).toBe(3);
  });
});
