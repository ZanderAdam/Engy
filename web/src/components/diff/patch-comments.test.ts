import { describe, it, expect } from 'vitest';
import { expandCollapsedBlockBy, parseDiff } from 'react-diff-view';
import type { HunkData } from 'react-diff-view';
import {
  anchorComments,
  countChanges,
  expansionSource,
  groupByChangeKey,
  lineForChange,
  sideForChange,
} from './patch-comments';
import type { DiffComment } from './use-diff-comments';

// Old lines 1-6, with line 3 deleted and a new line inserted after it.
const PATCH = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,6 +1,6 @@
 one
 two
-three
+THREE
 four
 five
 six
`;

function hunksOf(patch: string): HunkData[] {
  return parseDiff(patch)[0].hunks;
}

function comment(over: Partial<DiffComment>): DiffComment {
  return {
    threadId: 't1',
    documentPath: 'diff:///repo/a.ts',
    lineNumber: 1,
    codeLine: '',
    side: 'modified',
    resolved: false,
    source: 'local',
    comments: [],
    ...over,
  };
}

describe('patch comments', () => {
  const hunks = hunksOf(PATCH);

  describe('sideForChange', () => {
    it('[FR-GIT-420] should record a deleted line against the original side', () => {
      const deleted = hunks[0].changes.find((c) => c.type === 'delete')!;

      expect(sideForChange(deleted)).toBe('original');
    });

    it('[FR-GIT-420] should record an inserted line against the modified side', () => {
      const inserted = hunks[0].changes.find((c) => c.type === 'insert')!;

      expect(sideForChange(inserted)).toBe('modified');
    });

    it('[FR-GIT-420] should record a context line against the modified side', () => {
      const normal = hunks[0].changes.find((c) => c.type === 'normal')!;

      expect(sideForChange(normal)).toBe('modified');
    });
  });

  describe('lineForChange', () => {
    it('[FR-GIT-420] should number a deleted line by its old position', () => {
      const deleted = hunks[0].changes.find((c) => c.type === 'delete')!;

      expect(lineForChange(deleted)).toBe(3);
    });

    it('[FR-GIT-420] should number an inserted line by its new position', () => {
      const inserted = hunks[0].changes.find((c) => c.type === 'insert')!;

      expect(lineForChange(inserted)).toBe(3);
    });
  });

  describe('anchorComments', () => {
    it('[FR-GIT-420] should anchor a modified-side thread to the inserted line', () => {
      const { anchors, unanchored } = anchorComments(hunks, [
        comment({ lineNumber: 3, side: 'modified' }),
      ]);

      expect(unanchored).toHaveLength(0);
      expect(anchors.get('t1')).toBe('I3');
    });

    it('[FR-GIT-420] should anchor an original-side thread to the deleted line', () => {
      const { anchors, unanchored } = anchorComments(hunks, [
        comment({ lineNumber: 3, side: 'original' }),
      ]);

      expect(unanchored).toHaveLength(0);
      expect(anchors.get('t1')).toBe('D3');
    });

    it('[FR-GIT-420] should key a context line on its old line number, not its new one', () => {
      // Line 5 is context; a key built by hand from the stored (new) number would
      // be wrong whenever the two sides have drifted apart.
      const { anchors } = anchorComments(hunks, [comment({ lineNumber: 5, side: 'modified' })]);

      expect(anchors.get('t1')).toBe('N5');
    });

    it('[FR-GIT-420] should list a thread whose line is not rendered rather than drop it', () => {
      const { anchors, unanchored } = anchorComments(hunks, [
        comment({ threadId: 'gone', lineNumber: 900, codeLine: 'far away' }),
      ]);

      expect(anchors.size).toBe(0);
      expect(unanchored.map((c) => c.threadId)).toEqual(['gone']);
    });

    it('[FR-GIT-420] should re-anchor a thread once its region is expanded', () => {
      const twoHunks = hunksOf(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+A
@@ -40,1 +40,1 @@
-z
+Z
`);
      const inGap = [comment({ lineNumber: 20 })];

      expect(anchorComments(twoHunks, inGap).unanchored).toHaveLength(1);

      // Standing in for what `useSourceExpansion` returns after an expand click.
      const expanded = hunksOf(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+A
@@ -19,3 +19,3 @@
 nineteen
 twenty
 twentyone
@@ -40,1 +40,1 @@
-z
+Z
`);

      expect(anchorComments(expanded, inGap).unanchored).toHaveLength(0);
    });

    it('[FR-GIT-420] should anchor several threads on one line together', () => {
      const { anchors } = anchorComments(hunks, [
        comment({ threadId: 'a', lineNumber: 3 }),
        comment({ threadId: 'b', lineNumber: 3 }),
      ]);

      expect(anchors.get('a')).toBe('I3');
      expect(anchors.get('b')).toBe('I3');
    });
  });

  describe('groupByChangeKey', () => {
    it('[FR-GIT-420] should collect every thread sharing a change into one widget', () => {
      const comments = [
        comment({ threadId: 'a', lineNumber: 3 }),
        comment({ threadId: 'b', lineNumber: 3 }),
        comment({ threadId: 'c', lineNumber: 5 }),
      ];
      const { anchors } = anchorComments(hunks, comments);

      const grouped = groupByChangeKey(comments, anchors);

      expect(grouped.get('I3')?.map((c) => c.threadId)).toEqual(['a', 'b']);
      expect(grouped.get('N5')?.map((c) => c.threadId)).toEqual(['c']);
    });

    it('[FR-GIT-420] should leave an unanchored thread out of the widgets', () => {
      const comments = [comment({ threadId: 'gone', lineNumber: 900 })];
      const { anchors } = anchorComments(hunks, comments);

      expect(groupByChangeKey(comments, anchors).size).toBe(0);
    });
  });

  describe('expansionSource', () => {
    it('[FR-GIT-400] should supply the source when there are hunks to expand into', () => {
      expect(expansionSource(hunks, 'a\nb\nc')).toBe('a\nb\nc');
    });

    it('[FR-GIT-400] should withhold the source when the patch has no hunks', () => {
      // react-diff-view 3.3.3 reads `hunks[0].oldStart` unguarded, so this pair
      // throws — reachable whenever a new patch is in flight while the previous
      // file's source is still held.
      expect(() => expandCollapsedBlockBy([], 'a\nb\nc', () => true)).toThrow();
      expect(expansionSource([], 'a\nb\nc')).toBeNull();
    });

    it('[FR-GIT-400] should withhold an empty source, which expands nothing anyway', () => {
      expect(expansionSource(hunks, '')).toBeNull();
    });
  });

  describe('countChanges', () => {
    it('[FR-GIT-410] should count every rendered row across all hunks', () => {
      expect(countChanges(hunks)).toBe(7);
    });

    it('[FR-GIT-410] should count nothing for a patch with no hunks', () => {
      expect(countChanges([])).toBe(0);
    });
  });
});
