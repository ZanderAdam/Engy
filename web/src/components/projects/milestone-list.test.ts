import { describe, it, expect } from 'vitest';
import { overviewVisibleTasks, sortMilestones, sortTaskGroups } from './milestone-list';
import type { Task } from './types';
import type { TaskStatus } from '@/lib/task-status';

const ms = (num: number, status: string) => ({
  ref: `m${num}`,
  num,
  title: `Milestone ${num}`,
  status,
  filename: `m${num}.md`,
});

describe('overviewVisibleTasks', () => {
  const milestones = [ms(1, 'active'), ms(2, 'complete')];
  const task = (id: number, overrides: Partial<Task>): Task =>
    ({ id, status: 'todo', milestoneRef: null, taskGroupId: null, ...overrides }) as Task;
  const groups = [
    { id: 7, milestoneRef: null },
    { id: 8, milestoneRef: 'm1' },
  ];
  const tasks = [
    task(1, { milestoneRef: 'm1' }),
    task(2, { milestoneRef: 'm2' }),
    task(3, { taskGroupId: 7 }),
    task(4, {}),
    task(5, { milestoneRef: 'm1', status: 'done' }),
  ];
  const visibleIds = (input: Task[], showDone: boolean) =>
    overviewVisibleTasks(input, milestones, groups, showDone).map((t) => t.id);

  it('[FR-TASK-280] should keep only tasks the overview renders', () => {
    expect(visibleIds(tasks, false)).toEqual([1, 3]);
  });

  it('[FR-TASK-280] should include closed tasks and complete milestones with show done', () => {
    expect(visibleIds(tasks, true)).toEqual([1, 2, 3, 5]);
  });

  it('[FR-TASK-280] should drop a milestone group task with no milestone of its own', () => {
    expect(visibleIds([task(6, { taskGroupId: 8 })], false)).toEqual([]);
  });

  it('[FR-TASK-280] should drop a task whose milestone differs from its group', () => {
    expect(visibleIds([task(6, { taskGroupId: 8, milestoneRef: 'm3' })], false)).toEqual([]);
  });

  it('[FR-TASK-280] should keep a standalone group task under a complete milestone', () => {
    expect(visibleIds([task(6, { taskGroupId: 7, milestoneRef: 'm2' })], false)).toEqual([6]);
  });
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
  numInMilestone: id,
});

const task = (id: number, taskGroupId: number, status: TaskStatus): Task => ({
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
