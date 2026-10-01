import { describe, expect, it } from 'vitest';
import {
  classifyPath,
  classifyPaths,
  countPatchLines,
  implementationLines,
  implementationLinesFromPatches,
  orderByClass,
  parseGitattributes,
  revealClassOf,
  type FileClass,
} from './file-classes';

describe('file classes', () => {
  describe('[FR-PRREVIEW-160] classifyPath by path rules', () => {
    it.each([
      ['web/src/app.ts', 'implementation'],
      ['web/src/app.test.ts', 'test'],
      ['web/src/app.spec.tsx', 'test'],
      ['web/src/__tests__/app.ts', 'test'],
      ['test/helpers.ts', 'test'],
      ['README.md', 'docs'],
      ['docs/guide/setup.txt', 'docs'],
      ['pnpm-lock.yaml', 'lockfile'],
      ['pkg/package-lock.json', 'lockfile'],
      ['yarn.lock', 'lockfile'],
      ['Cargo.lock', 'lockfile'],
      ['go.sum', 'lockfile'],
      ['deps/poetry.lock', 'lockfile'],
      ['web/drizzle/meta/0012_snapshot.json', 'generated'],
      ['src/__snapshots__/a.test.ts.snap', 'generated'],
      ['packages/x/dist/index.js', 'generated'],
      ['src/generated/types.ts', 'generated'],
      ['public/app.min.js', 'generated'],
    ])('should classify %s as %s', (path, expected) => {
      expect(classifyPath(path)).toBe(expected);
    });
  });

  describe('classifyPath with .gitattributes', () => {
    it('[FR-PRREVIEW-170] should mark files generated when linguist-generated is set', () => {
      const rules = parseGitattributes('*.pb.ts linguist-generated=true\n');
      expect(classifyPath('api/user.pb.ts', rules)).toBe('generated');
    });

    it('[FR-PRREVIEW-170] should mark files docs when linguist-documentation is set', () => {
      const rules = parseGitattributes('/notes/** linguist-documentation\n');
      expect(classifyPath('notes/a/b.txt', rules)).toBe('docs');
      expect(classifyPath('src/notes/b.txt', rules)).toBe('implementation');
    });

    it('[FR-PRREVIEW-170] should let a later rule override an earlier one', () => {
      const rules = parseGitattributes(
        '*.gen.ts linguist-generated\nkeep.gen.ts -linguist-generated\n',
      );
      expect(classifyPath('a/keep.gen.ts', rules)).toBe('implementation');
      expect(classifyPath('a/other.gen.ts', rules)).toBe('generated');
    });

    it('[FR-PRREVIEW-170] should turn off a path rule when the attribute is false', () => {
      const rules = parseGitattributes('dist/** linguist-generated=false\n');
      expect(classifyPath('dist/index.js', rules)).toBe('implementation');
    });

    it('[FR-PRREVIEW-170] should ignore comments and unrelated attributes', () => {
      const rules = parseGitattributes('# note\n*.png binary\n* text=auto\n');
      expect(rules).toEqual([]);
    });
  });

  describe('orderByClass', () => {
    it('[FR-PRREVIEW-180] should list implementation first and keep order inside a class', () => {
      const files = [
        { path: 'pnpm-lock.yaml' },
        { path: 'a.test.ts' },
        { path: 'b.ts' },
        { path: 'a.ts' },
      ];
      const ordered = orderByClass(files, classifyPaths(files.map((f) => f.path)));
      expect(ordered.map((f) => f.path)).toEqual(['b.ts', 'a.ts', 'a.test.ts', 'pnpm-lock.yaml']);
    });
  });

  describe('[FR-PRREVIEW-190] line counts', () => {
    it('should count hunk lines and skip headers', () => {
      const patch = [
        '--- a/x',
        '+++ b/x',
        '@@ -1,2 +1,2 @@',
        '-old',
        '--flag',
        '+new',
        ' ctx',
      ].join('\n');
      expect(countPatchLines(patch)).toEqual({ added: 1, removed: 2 });
    });

    it('should subtract other classes from the total', () => {
      const result = implementationLines({ added: 100, removed: 20 }, [
        { added: 30, removed: 5 },
        { added: 10, removed: 0 },
      ]);
      expect(result).toEqual({ added: 60, removed: 15 });
    });

    it('should never go below zero', () => {
      expect(implementationLines({ added: 1, removed: 1 }, [{ added: 5, removed: 5 }])).toEqual({
        added: 0,
        removed: 0,
      });
    });
  });
});

describe('[FR-PRREVIEW-190] implementationLinesFromPatches', () => {
  const total = { added: 100, removed: 20 };
  const patch = '@@ -1 +1,2 @@\n-a\n+b\n+c';
  const loaded = { isLoading: false, isError: false, data: { patch, truncated: false } };

  it('should subtract the counted patches from the total', () => {
    expect(implementationLinesFromPatches(total, [loaded])).toEqual({ added: 98, removed: 19 });
  });

  it('should return null when a patch is truncated', () => {
    const truncated = { ...loaded, data: { patch, truncated: true } };
    expect(implementationLinesFromPatches(total, [loaded, truncated])).toBeNull();
  });

  it('should return null when a patch failed or is still loading', () => {
    expect(implementationLinesFromPatches(total, [{ isLoading: false, isError: true }])).toBeNull();
    expect(implementationLinesFromPatches(total, [{ isLoading: true, isError: false }])).toBeNull();
  });
});

describe('revealClassOf', () => {
  const classes = new Map<string, FileClass>([
    ['pnpm-lock.yaml', 'lockfile'],
    ['src/app.ts', 'implementation'],
  ]);
  const collapsed = new Set<FileClass>(['lockfile', 'generated']);

  it('should expand the group holding the selected file', () => {
    const next = revealClassOf(collapsed, 'unstaged:pnpm-lock.yaml', 'unstaged:', classes);
    expect([...next]).toEqual(['generated']);
  });

  it('should return the same set when the selected file is already visible', () => {
    expect(revealClassOf(collapsed, 'unstaged:src/app.ts', 'unstaged:', classes)).toBe(collapsed);
  });

  it('should return the same set when nothing is selected', () => {
    expect(revealClassOf(collapsed, null, 'unstaged:', classes)).toBe(collapsed);
  });

  it('should treat an unclassified file as implementation', () => {
    const lonely = new Set<FileClass>(['implementation']);
    expect(revealClassOf(lonely, 'unstaged:x.ts', 'unstaged:', new Map()).size).toBe(0);
  });
});
