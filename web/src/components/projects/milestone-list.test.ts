import { describe, it, expect } from 'vitest';
import { sortMilestones, sortTaskGroups } from './milestone-list';
import type { Task } from './types';

const ms = (num: number, status: string) => ({
  ref: `m${num}`,
  num,
  title: `Milestone ${num}`,
  status,
  filename: `m${num}.md`,
});

describe('sortMilestones', () => {
  it('should sort by num when all statuses are the same', () => {
    const milestones = [ms(3, 'planned'), ms(1, 'planned'), ms(2, 'planned')];
    const result = sortMilestones(milestones);
    expect(result.map((m) => m.num)).toEqual([1, 2, 3]);
  });

  it('should push completed milestones to the bottom', () => {
    const milestones = [
      ms(1, 'complete'),
      ms(2, 'planned'),
      ms(3, 'complete'),
      ms(4, 'in_progress'),
    ];
    const result = sortMilestones(milestones);
    expect(result.map((m) => m.num)).toEqual([2, 4, 1, 3]);
  });

  it('should preserve num order within completed milestones', () => {
    const milestones = [ms(5, 'complete'), ms(2, 'complete'), ms(3, 'complete')];
    const result = sortMilestones(milestones);
    expect(result.map((m) => m.num)).toEqual([2, 3, 5]);
  });

  it('should preserve num order within non-completed milestones', () => {
    const milestones = [ms(4, 'planned'), ms(1, 'in_progress'), ms(2, 'planned')];
    const result = sortMilestones(milestones);
    expect(result.map((m) => m.num)).toEqual([1, 2, 4]);
  });

  it('should not mutate the original array', () => {
    const milestones = [ms(2, 'complete'), ms(1, 'planned')];
    sortMilestones(milestones);
    expect(milestones[0].num).toBe(2);
  });

  it('should handle empty array', () => {
    expect(sortMilestones([])).toEqual([]);
  });
});

const tg = (id: number) => ({
  id,
  milestoneRef: 'm1',
  name: `Phase ${id}`,
  status: 'active' as const,
});

const task = (id: number, taskGroupId: number, status: string): Task => ({
  id,
  projectId: 1,
  milestoneRef: 'm1',
  taskGroupId,
  title: `Task ${id}`,
  description: null,
  status,
  type: 'human',
  importance: null,
  urgency: null,
  subStatus: null,
  needsPlan: false,
  specId: null,
  createdAt: '',
  updatedAt: '',
});

describe('sortTaskGroups', () => {
  it('should push all-done TGs to the bottom', () => {
    const groups = [tg(1), tg(2), tg(3), tg(4), tg(5)];
    const tasksByGroup = new Map([
      [1, [task(1, 1, 'done'), task(2, 1, 'done')]],
      [2, [task(3, 2, 'done'), task(4, 2, 'done')]],
      [3, [task(5, 3, 'done')]],
      [4, [task(6, 4, 'in_progress')]],
      [5, [task(7, 5, 'todo')]],
    ]);
    const result = sortTaskGroups(groups, tasksByGroup);
    expect(result.map((g) => g.id)).toEqual([4, 5, 1, 2, 3]);
  });

  it('should treat empty TGs (no tasks) as incomplete', () => {
    const groups = [tg(1), tg(2)];
    const tasksByGroup = new Map([[1, [task(1, 1, 'done')]]]);
    const result = sortTaskGroups(groups, tasksByGroup);
    expect(result.map((g) => g.id)).toEqual([2, 1]);
  });

  it('should preserve ID order within groups', () => {
    const groups = [tg(5), tg(2), tg(3)];
    const tasksByGroup = new Map<number, Task[]>();
    const result = sortTaskGroups(groups, tasksByGroup);
    expect(result.map((g) => g.id)).toEqual([2, 3, 5]);
  });

  it('should not mutate the original array', () => {
    const groups = [tg(2), tg(1)];
    const tasksByGroup = new Map([[2, [task(1, 2, 'done')]]]);
    sortTaskGroups(groups, tasksByGroup);
    expect(groups[0].id).toBe(2);
  });

  it('should handle empty array', () => {
    expect(sortTaskGroups([], new Map())).toEqual([]);
  });
});
