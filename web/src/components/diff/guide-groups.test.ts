import { describe, expect, it } from 'vitest';
import type { ReadingChapter } from '@/lib/review-summary-meta';
import { groupByChapters, OTHER_GROUP_ID, stepGroup } from './guide-groups';

const file = (path: string, staged = false) => ({ path, staged });

const chapter = (title: string, files: string[]): ReadingChapter => ({ title, files, note: '' });

describe('guide-groups', () => {
  describe('[FR-PRREVIEW-330] groupByChapters', () => {
    it('should order groups as the chapters and files as each chapter lists them', () => {
      const groups = groupByChapters(
        [file('a.ts'), file('b.ts'), file('c.ts')],
        [chapter('Core', ['c.ts', 'a.ts']), chapter('Wiring', ['b.ts'])],
      );

      expect(groups.map((g) => [g.number, g.chapter?.title, g.files.map((f) => f.path)])).toEqual([
        [1, 'Core', ['c.ts', 'a.ts']],
        [2, 'Wiring', ['b.ts']],
      ]);
    });

    it('should put files no chapter lists in a last Other group in diff order', () => {
      const groups = groupByChapters(
        [file('z.ts'), file('a.ts'), file('y.ts')],
        [chapter('Core', ['a.ts'])],
      );

      expect(groups.at(-1)).toMatchObject({ id: OTHER_GROUP_ID, chapter: null, number: 2 });
      expect(groups.at(-1)?.files.map((f) => f.path)).toEqual(['z.ts', 'y.ts']);
    });

    it('should give a file listed twice to the first chapter only', () => {
      const groups = groupByChapters(
        [file('a.ts')],
        [chapter('Core', ['a.ts']), chapter('Again', ['a.ts'])],
      );

      expect(groups.map((g) => g.chapter?.title)).toEqual(['Core']);
    });

    it('should list a path once when one chapter repeats it', () => {
      const groups = groupByChapters([file('a.ts')], [chapter('Core', ['a.ts', 'a.ts'])]);

      expect(groups[0].files).toEqual([file('a.ts')]);
    });

    it('should drop chapters whose files are not in the diff', () => {
      const groups = groupByChapters(
        [file('a.ts')],
        [chapter('Gone', ['old.ts']), chapter('Core', ['a.ts'])],
      );

      expect(groups.map((g) => [g.number, g.chapter?.title])).toEqual([[1, 'Core']]);
    });

    it('should keep both rows of a path changed on both sides of the index', () => {
      const groups = groupByChapters(
        [file('a.ts', true), file('a.ts', false)],
        [chapter('Core', ['a.ts'])],
      );

      expect(groups[0].files).toEqual([file('a.ts', true), file('a.ts', false)]);
    });

    it('should return no groups without chapters', () => {
      expect(groupByChapters([file('a.ts')], [])).toEqual([]);
    });
  });

  describe('[FR-PRREVIEW-340] stepGroup', () => {
    const groups = groupByChapters(
      [file('a.ts'), file('b.ts'), file('c.ts')],
      [chapter('Core', ['a.ts', 'b.ts']), chapter('Tests', ['c.ts'])],
    );

    it('should go to the first file of the next or previous group', () => {
      expect(stepGroup(groups, 'b.ts', 1)).toBe('c.ts');
      expect(stepGroup(groups, 'c.ts', -1)).toBe('a.ts');
    });

    it('should wrap and start at the matching end when no file is current', () => {
      expect(stepGroup(groups, 'c.ts', 1)).toBe('a.ts');
      expect(stepGroup(groups, null, 1)).toBe('a.ts');
      expect(stepGroup(groups, null, -1)).toBe('c.ts');
    });

    it('should return null without groups', () => {
      expect(stepGroup([], 'a.ts', 1)).toBeNull();
    });
  });
});
