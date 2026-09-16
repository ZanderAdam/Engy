import { describe, it, expect } from 'vitest';
import {
  defaultTaskPlanFilename,
  planFilePathFromStem,
  planOutputTarget,
  planStemFromFilename,
  planStemFromWatchedPath,
  taskPlanSlug,
  taskIdFromStem,
  taskSlugFromStem,
} from './plan-naming';

describe('plan naming', () => {
  describe('taskPlanSlug', () => {
    it('joins workspace slug and task id', () => {
      expect(taskPlanSlug('engy', 42)).toBe('engy-T42');
    });

    it('returns empty string when workspace slug is empty', () => {
      expect(taskPlanSlug('', 42)).toBe('');
    });
  });

  describe('taskIdFromStem', () => {
    it('[FR-PROJECT-180] reads the id from a bare stem', () => {
      expect(taskIdFromStem('engy-T42', 'engy')).toBe(42);
    });

    it('[FR-PROJECT-180] reads the id from a described stem', () => {
      expect(taskIdFromStem('engy-T42-add-api-routing', 'engy')).toBe(42);
    });

    it('[FR-PROJECT-180] does not confuse a longer id sharing the prefix', () => {
      expect(taskIdFromStem('engy-T420-add-api-routing', 'engy')).toBe(420);
    });

    it('[FR-PROJECT-180] rejects another workspace', () => {
      expect(taskIdFromStem('other-T42', 'engy')).toBeNull();
    });

    it('[FR-PROJECT-180] rejects a stem carrying no task id', () => {
      expect(taskIdFromStem('m1-foundation', 'engy')).toBeNull();
    });

    it('[FR-PROJECT-180] rejects an empty workspace slug', () => {
      expect(taskIdFromStem('engy-T42', '')).toBeNull();
    });
  });

  describe('path helpers', () => {
    it('builds a project-relative plan path from a stem', () => {
      expect(planFilePathFromStem('engy-T42-add-api-routing')).toBe(
        'plans/engy-T42-add-api-routing.plan.md',
      );
    });

    it('strips the plan extension', () => {
      expect(planStemFromFilename('engy-T42-add-api-routing.plan.md')).toBe(
        'engy-T42-add-api-routing',
      );
    });

    it('falls back to the bare slug filename', () => {
      expect(defaultTaskPlanFilename('engy-T42')).toBe('engy-T42.plan.md');
    });

    it('reads the stem out of a watched plan path', () => {
      expect(planStemFromWatchedPath('/ws/projects/default/plans/engy-T42-add-api.plan.md')).toBe(
        'engy-T42-add-api',
      );
    });

    it('ignores a watched path outside the plans directory', () => {
      expect(planStemFromWatchedPath('/ws/projects/default/docs/engy-T42.plan.md')).toBeNull();
    });

    it('ignores a watched non-plan file', () => {
      expect(planStemFromWatchedPath('/ws/projects/default/plans/notes.md')).toBeNull();
    });

    it('[FR-PROJECT-180] recovers the task slug from a described stem', () => {
      expect(taskSlugFromStem('engy-T123-add-api-routing')).toBe('engy-T123');
    });

    it('[FR-PROJECT-180] recovers the task slug from a bare stem', () => {
      expect(taskSlugFromStem('engy-T123')).toBe('engy-T123');
    });

    it('[FR-PROJECT-180] keeps the full id when a description repeats the slug shape', () => {
      expect(taskSlugFromStem('engy-T123-revert-T9-change')).toBe('engy-T123');
    });
  });

  describe('planOutputTarget', () => {
    it('reuses the existing plan path for a replan', () => {
      expect(planOutputTarget('/w/proj', 'engy-T42', 'plans/engy-T42-add-api-routing.plan.md')).toBe(
        '/w/proj/plans/engy-T42-add-api-routing.plan.md',
      );
    });

    it('asks the agent for a description when no plan exists', () => {
      expect(planOutputTarget('/w/proj', 'engy-T42', null)).toContain(
        '/w/proj/plans/engy-T42-<short-slug>.plan.md',
      );
    });
  });
});
