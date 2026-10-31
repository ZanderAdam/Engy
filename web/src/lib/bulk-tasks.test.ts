import { describe, it, expect } from 'vitest';
import {
  buildBulkImplementPrompt,
  formatTaskCount,
  formatTaskSlugs,
  openTasks,
  selectedVisibleTasks,
  tasksMissingPlan,
} from './bulk-tasks';

describe('bulk tasks', () => {
  describe('selectedVisibleTasks', () => {
    it('[FR-TASK-290] should drop selected tasks that are no longer visible', () => {
      const visible = [{ id: 1 }, { id: 2 }];
      expect(selectedVisibleTasks(visible, new Set([2, 3]))).toEqual([{ id: 2 }]);
    });
  });

  describe('openTasks', () => {
    it('[FR-TASK-300] should exclude done and wont_do tasks', () => {
      const tasks = [
        { id: 1, status: 'todo' },
        { id: 2, status: 'done' },
        { id: 3, status: 'wont_do' },
      ];
      expect(openTasks(tasks)).toEqual([tasks[0]]);
    });
  });

  describe('formatTaskCount', () => {
    it('should use the singular form for one task', () => {
      expect(formatTaskCount(1)).toBe('1 task');
      expect(formatTaskCount(2)).toBe('2 tasks');
    });
  });

  describe('formatTaskSlugs', () => {
    it('[FR-TASK-290] should join workspace-prefixed slugs with commas', () => {
      expect(formatTaskSlugs('engy', [1, 2])).toBe('engy-T1, engy-T2');
    });
  });

  describe('tasksMissingPlan', () => {
    it('[FR-TASK-310] should return only tasks that need a plan and have none', () => {
      const tasks = [
        { id: 1, needsPlan: true },
        { id: 2, needsPlan: true },
        { id: 3, needsPlan: false },
      ];
      expect(tasksMissingPlan(tasks, { 2: 'plans/engy-T2.plan.md' })).toEqual([tasks[0]]);
    });
  });

  describe('buildBulkImplementPrompt', () => {
    const base = {
      implementSkill: '/engy:implement',
      workspaceSlug: 'engy',
      projectDir: '/docs/projects/default',
    };

    it('[FR-TASK-300] should name every task in one prompt', () => {
      const prompt = buildBulkImplementPrompt({
        ...base,
        tasks: [
          { id: 1, needsPlan: false },
          { id: 2, needsPlan: false },
        ],
        taskPlans: {},
      });
      expect(prompt).toBe('Use /engy:implement for tasks: engy-T1, engy-T2');
    });

    it('[FR-TASK-300] should add plan paths for tasks that need a plan', () => {
      const prompt = buildBulkImplementPrompt({
        ...base,
        tasks: [
          { id: 1, needsPlan: true },
          { id: 2, needsPlan: false },
        ],
        taskPlans: { 1: 'plans/engy-T1.plan.md', 2: 'plans/engy-T2.plan.md' },
      });
      expect(prompt).toBe(
        'Use /engy:implement for tasks: engy-T1, engy-T2, engy-T1 plan at /docs/projects/default/plans/engy-T1.plan.md',
      );
    });
  });
});
