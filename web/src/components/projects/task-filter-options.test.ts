import { describe, it, expect } from 'vitest';
import {
  milestoneFilterOptions,
  groupFilterOptions,
  withOrphanOptions,
} from './task-filter-options';

function task(
  overrides: Partial<{ status: string; taskGroupId: number | null; milestoneRef: string | null }>,
) {
  return { status: 'todo', taskGroupId: null, milestoneRef: null, ...overrides };
}

describe('task filter options', () => {
  describe('milestoneFilterOptions', () => {
    it('should keep milestones that still have open tasks', () => {
      const milestones = [{ ref: 'm1', title: 'One' }];
      const tasks = [task({ status: 'todo', milestoneRef: 'm1' })];

      expect(milestoneFilterOptions(milestones, tasks, [])).toEqual(milestones);
    });

    it('should drop milestones whose tasks are all done', () => {
      const milestones = [{ ref: 'm1', title: 'One' }];
      const tasks = [task({ status: 'done', milestoneRef: 'm1' })];

      expect(milestoneFilterOptions(milestones, tasks, [])).toEqual([]);
    });

    it('should keep a selected milestone whose tasks are all done', () => {
      const milestones = [{ ref: 'm1', title: 'One' }];
      const tasks = [task({ status: 'done', milestoneRef: 'm1' })];

      expect(milestoneFilterOptions(milestones, tasks, ['m1'])).toEqual(milestones);
    });

    it('should not duplicate a milestone that is both open and selected', () => {
      const milestones = [{ ref: 'm1', title: 'One' }];
      const tasks = [task({ status: 'todo', milestoneRef: 'm1' })];

      expect(milestoneFilterOptions(milestones, tasks, ['m1'])).toHaveLength(1);
    });
  });

  describe('groupFilterOptions', () => {
    it('should keep groups that still have open tasks', () => {
      const groups = [{ id: 7, name: 'TG7' }];
      const tasks = [task({ status: 'todo', taskGroupId: 7 })];

      expect(groupFilterOptions(groups, tasks, [])).toEqual(groups);
    });

    it('should drop groups whose tasks are all done', () => {
      const groups = [{ id: 7, name: 'TG7' }];
      const tasks = [task({ status: 'done', taskGroupId: 7 })];

      expect(groupFilterOptions(groups, tasks, [])).toEqual([]);
    });

    it('should keep a selected group whose tasks are all done', () => {
      const groups = [{ id: 7, name: 'TG7' }];
      const tasks = [task({ status: 'done', taskGroupId: 7 })];

      expect(groupFilterOptions(groups, tasks, [7])).toEqual(groups);
    });
  });

  describe('withOrphanOptions', () => {
    it('should leave options untouched when every selection is known', () => {
      const options = [{ value: 'm1', label: 'One' }];

      expect(withOrphanOptions(options, ['m1'])).toEqual(options);
    });

    it('should append a raw option for a selection with no matching option', () => {
      const options = [{ value: 'm1', label: 'One' }];

      expect(withOrphanOptions(options, ['m1', 'm9'])).toEqual([
        { value: 'm1', label: 'One' },
        { value: 'm9', label: 'm9' },
      ]);
    });

    it('should append nothing when there is no selection', () => {
      expect(withOrphanOptions([{ value: 'm1', label: 'One' }], [])).toHaveLength(1);
    });
  });
});
