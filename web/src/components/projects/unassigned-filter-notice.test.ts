import { describe, it, expect } from 'vitest';
import { emptyFilters } from '@/components/projects/task-filter';
import { countHiddenByUnassignedOnly } from '@/components/projects/unassigned-filter-notice';

function task(taskGroupId: number | null, milestoneRef: string | null, status = 'todo') {
  return { status, type: 'ai', taskGroupId, milestoneRef };
}

describe('unassigned filter notice', () => {
  describe('countHiddenByUnassignedOnly', () => {
    it('[FR-TASK-270] should count tasks hidden only because they are in a group or milestone', () => {
      const tasks = [task(null, null), task(1, null), task(null, 'm1'), task(2, 'm1')];
      expect(countHiddenByUnassignedOnly(tasks, emptyFilters())).toBe(3);
    });

    it('[FR-TASK-270] should return 0 when the unassigned-only filter is off', () => {
      const tasks = [task(1, 'm1')];
      expect(countHiddenByUnassignedOnly(tasks, { ...emptyFilters(), unassignedOnly: false })).toBe(
        0,
      );
    });

    it('[FR-TASK-270] should not count tasks that other filters already hide', () => {
      const tasks = [task(1, null, 'todo'), task(2, null, 'done')];
      expect(countHiddenByUnassignedOnly(tasks, { ...emptyFilters(), status: ['todo'] })).toBe(1);
    });
  });
});
