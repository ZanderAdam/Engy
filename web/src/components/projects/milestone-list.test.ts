import { describe, it, expect } from 'vitest';
import { sortMilestones } from './milestone-list';

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
