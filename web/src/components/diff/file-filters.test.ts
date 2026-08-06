import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  allViewed,
  countByStatus,
  createPathMatcher,
  filterFiles,
  isFilterActive,
  toggleStatus,
} from './file-filters';
import { rowId } from './diff-selection';
import type { ChangedFile, GitFileStatus } from './types';

function file(path: string, status: GitFileStatus = 'modified', staged = false): ChangedFile {
  return { path, status, staged };
}

const FILES: ChangedFile[] = [
  file('web/src/components/diff/file-tree.tsx', 'modified'),
  file('web/src/components/diff/NewPanel.tsx', 'added'),
  file('client/src/git/index.ts', 'modified'),
  file('client/src/old-helper.ts', 'deleted'),
  file('docs/README.md', 'renamed'),
];

describe('file filters', () => {
  describe('createPathMatcher', () => {
    it('matches every path when the query is empty', () => {
      const matcher = createPathMatcher('', 'substring', false);

      expect(matcher.matches('anything/at/all.ts')).toBe(true);
    });

    it('ignores case by default in substring mode', () => {
      const matcher = createPathMatcher('NEWPANEL', 'substring', false);

      expect(matcher.matches('web/src/NewPanel.tsx')).toBe(true);
    });

    it('respects case when matchCase is set', () => {
      const matcher = createPathMatcher('NEWPANEL', 'substring', true);

      expect(matcher.matches('web/src/NewPanel.tsx')).toBe(false);
    });

    it('applies the query as a regular expression in regex mode', () => {
      const matcher = createPathMatcher('\\.tsx?$', 'regex', false);

      expect(matcher.matches('a/b.ts')).toBe(true);
      expect(matcher.matches('a/b.tsx')).toBe(true);
      expect(matcher.matches('a/b.md')).toBe(false);
    });

    it('reports an error and matches everything for a malformed regex', () => {
      const matcher = createPathMatcher('foo(', 'regex', false);

      expect(matcher.error).toBeDefined();
      expect(matcher.matches('anything')).toBe(true);
    });

    it('confines a single star to one path segment in glob mode', () => {
      const matcher = createPathMatcher('src/*.ts', 'glob', false);

      expect(matcher.matches('src/a.ts')).toBe(true);
      expect(matcher.matches('src/nested/a.ts')).toBe(false);
    });

    it('crosses separators for a double star, including zero directories', () => {
      const matcher = createPathMatcher('**/*.test.ts', 'glob', false);

      expect(matcher.matches('a.test.ts')).toBe(true);
      expect(matcher.matches('web/src/deep/a.test.ts')).toBe(true);
      expect(matcher.matches('web/src/a.ts')).toBe(false);
    });

    it('treats ? as exactly one non-separator character in glob mode', () => {
      const matcher = createPathMatcher('a?.ts', 'glob', false);

      expect(matcher.matches('ab.ts')).toBe(true);
      expect(matcher.matches('abc.ts')).toBe(false);
    });

    it('escapes regex metacharacters in glob literals', () => {
      const matcher = createPathMatcher('a+b.ts', 'glob', false);

      expect(matcher.matches('a+b.ts')).toBe(true);
      expect(matcher.matches('aab.ts')).toBe(false);
    });
  });

  describe('filterFiles', () => {
    it('returns every file when no filter is applied', () => {
      const { files } = filterFiles(FILES, EMPTY_FILTER);

      expect(files).toHaveLength(FILES.length);
    });

    it('keeps only the selected statuses', () => {
      const { files } = filterFiles(FILES, {
        ...EMPTY_FILTER,
        statuses: new Set<GitFileStatus>(['added', 'deleted']),
      });

      expect(files.map((f) => f.path)).toEqual([
        'web/src/components/diff/NewPanel.tsx',
        'client/src/old-helper.ts',
      ]);
    });

    it('combines a status filter with a path query', () => {
      const { files } = filterFiles(FILES, {
        ...EMPTY_FILTER,
        query: 'client/',
        statuses: new Set<GitFileStatus>(['modified']),
      });

      expect(files.map((f) => f.path)).toEqual(['client/src/git/index.ts']);
    });

    it('keeps only commented files when commentedOnly is set', () => {
      const commentCounts = new Map([['client/src/git/index.ts', 2]]);

      const { files } = filterFiles(
        FILES,
        { ...EMPTY_FILTER, commentedOnly: true },
        { commentCounts },
      );

      expect(files.map((f) => f.path)).toEqual(['client/src/git/index.ts']);
    });

    it('treats a zero comment count as uncommented', () => {
      const commentCounts = new Map([['client/src/git/index.ts', 0]]);

      const { files } = filterFiles(
        FILES,
        { ...EMPTY_FILTER, commentedOnly: true },
        { commentCounts },
      );

      expect(files).toHaveLength(0);
    });

    it('hides viewed files when unviewedOnly is set', () => {
      const viewedPaths = new Set([
        rowId(file('client/src/git/index.ts')),
        rowId(file('docs/README.md')),
      ]);

      const { files } = filterFiles(
        FILES,
        { ...EMPTY_FILTER, unviewedOnly: true },
        { viewedPaths },
      );

      expect(files.map((f) => f.path)).not.toContain('client/src/git/index.ts');
      expect(files).toHaveLength(3);
    });

    it('[FR-GIT-340] hides only the reviewed half of a path changed on both sides', () => {
      const both = [file('a.ts', 'modified', true), file('a.ts', 'modified', false)];
      const viewedPaths = new Set([rowId(both[0])]);

      const { files } = filterFiles(both, { ...EMPTY_FILTER, unviewedOnly: true }, { viewedPaths });

      expect(files).toEqual([both[1]]);
    });

    it('surfaces the matcher error without emptying the list', () => {
      const { files, error } = filterFiles(FILES, {
        ...EMPTY_FILTER,
        query: '[unclosed',
        matchMode: 'regex',
      });

      expect(error).toBeDefined();
      expect(files).toHaveLength(FILES.length);
    });
  });

  describe('countByStatus', () => {
    it('counts each status and reports zero for absent ones', () => {
      expect(countByStatus(FILES)).toEqual({
        added: 1,
        modified: 2,
        deleted: 1,
        renamed: 1,
      });
    });

    it('returns all zeroes for an empty list', () => {
      expect(countByStatus([])).toEqual({ added: 0, modified: 0, deleted: 0, renamed: 0 });
    });
  });

  describe('toggleStatus', () => {
    it('adds a status that is not selected', () => {
      expect([...toggleStatus(new Set(), 'added')]).toEqual(['added']);
    });

    it('removes a status that is already selected', () => {
      expect([...toggleStatus(new Set<GitFileStatus>(['added']), 'added')]).toEqual([]);
    });

    it('does not mutate the input set', () => {
      const original = new Set<GitFileStatus>(['added']);

      toggleStatus(original, 'deleted');

      expect([...original]).toEqual(['added']);
    });
  });

  describe('allViewed', () => {
    it('is true when every path is marked', () => {
      expect(allViewed(['a.ts', 'b.ts'], new Set(['a.ts', 'b.ts']))).toBe(true);
    });

    it('is false when any path is unmarked', () => {
      expect(allViewed(['a.ts', 'b.ts'], new Set(['a.ts']))).toBe(false);
    });

    it('is false for an empty list, so the bulk action never inverts on nothing', () => {
      expect(allViewed([], new Set(['a.ts']))).toBe(false);
    });

    it('ignores marks for paths outside the supplied list', () => {
      expect(allViewed(['a.ts'], new Set(['a.ts', 'unrelated.ts']))).toBe(true);
    });
  });

  describe('isFilterActive', () => {
    it('is false for the empty filter', () => {
      expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    });

    it('is true once any dimension is set', () => {
      expect(isFilterActive({ ...EMPTY_FILTER, query: 'a' })).toBe(true);
      expect(isFilterActive({ ...EMPTY_FILTER, statuses: new Set(['added']) })).toBe(true);
      expect(isFilterActive({ ...EMPTY_FILTER, commentedOnly: true })).toBe(true);
      expect(isFilterActive({ ...EMPTY_FILTER, unviewedOnly: true })).toBe(true);
    });

    it('is not triggered by match mode alone', () => {
      expect(isFilterActive({ ...EMPTY_FILTER, matchMode: 'regex', matchCase: true })).toBe(false);
    });
  });
});
