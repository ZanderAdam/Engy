import { describe, it, expect } from 'vitest';
import { decodeSelection, encodeSelection, findSelectedFile, rowId } from './diff-selection';
import type { ChangedFile } from './types';

const file = (path: string, staged: boolean): ChangedFile => ({
  path,
  status: 'modified',
  staged,
});

describe('diff selection', () => {
  describe('encodeSelection / decodeSelection', () => {
    it('[FR-GIT-260] round-trips each side of a path', () => {
      for (const side of ['staged', 'unstaged'] as const) {
        expect(decodeSelection(encodeSelection('web/app.ts', side), true)).toEqual({
          path: 'web/app.ts',
          side,
        });
      }
    });

    it('[FR-GIT-260] distinguishes the two sides of the same path', () => {
      expect(encodeSelection('a.ts', 'staged')).not.toBe(encodeSelection('a.ts', 'unstaged'));
    });

    it('[FR-GIT-260] leaves the path untouched where there is no side', () => {
      expect(encodeSelection('web/app.ts', null)).toBe('web/app.ts');
      expect(decodeSelection('web/app.ts', false)).toEqual({ path: 'web/app.ts', side: null });
    });

    it('[FR-GIT-260] does not read a side out of a path that merely looks like one', () => {
      expect(decodeSelection('staged:notes.md', false)).toEqual({
        path: 'staged:notes.md',
        side: null,
      });
    });

    it('[FR-GIT-260] qualifies a path that looks like a side without losing it', () => {
      const id = encodeSelection('staged:notes.md', 'unstaged');
      expect(decodeSelection(id, true)).toEqual({ path: 'staged:notes.md', side: 'unstaged' });
    });

    it('[FR-GIT-260] reports nothing selected for a null id', () => {
      expect(decodeSelection(null, true)).toEqual({ path: null, side: null });
    });
  });

  describe('rowId', () => {
    it('[FR-GIT-340] addresses the two halves of a path separately', () => {
      expect(rowId(file('a.ts', true))).not.toBe(rowId(file('a.ts', false)));
    });

    it('[FR-GIT-340] stays side-qualified even where selection is not', () => {
      // History and branch views hand back bare paths, but review progress is
      // still recorded per row so one scheme covers every mode.
      expect(rowId(file('a.ts', false))).toBe(encodeSelection('a.ts', 'unstaged'));
    });
  });

  describe('findSelectedFile', () => {
    it('[FR-GIT-260] picks the row matching the selected side', () => {
      const files = [file('a.ts', true), file('a.ts', false)];

      expect(findSelectedFile(files, 'a.ts', 'staged')?.staged).toBe(true);
      expect(findSelectedFile(files, 'a.ts', 'unstaged')?.staged).toBe(false);
    });

    it('[FR-GIT-260] matches on path alone where no side is tracked', () => {
      const files = [file('a.ts', false)];

      expect(findSelectedFile(files, 'a.ts', null)).toBe(files[0]);
    });

    it('[FR-GIT-260] finds nothing when the path is absent or unselected', () => {
      expect(findSelectedFile([file('a.ts', false)], 'b.ts', null)).toBeUndefined();
      expect(findSelectedFile([file('a.ts', false)], null, null)).toBeUndefined();
    });
  });
});
