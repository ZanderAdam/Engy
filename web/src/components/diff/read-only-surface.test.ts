import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIFF_DIR = join(import.meta.dirname, '.');

function source(file: string): string {
  return readFileSync(join(DIFF_DIR, file), 'utf8');
}

/**
 * The Diffs tab is a review surface, not an editor. Autosave writing the file
 * under review is what let an agent's write race a reviewer's keystrokes, so the
 * write path is gone rather than guarded.
 *
 * This reads source rather than rendering: the repo has no React test renderer,
 * and the invariant is "no write path exists", which is a structural claim.
 */
describe('diff surface is read-only', () => {
  const surfaces = ['diffs-page.tsx', 'dir-diff-panel.tsx', 'diff-viewer-panel.tsx'];

  it('[FR-GIT-430] should wire no auto-save into any diff surface', () => {
    for (const file of surfaces) {
      expect(source(file), `${file} still wires auto-save`).not.toMatch(/useAutoSave/);
    }
  });

  it('[FR-GIT-430] should mount no editor in any diff surface', () => {
    for (const file of surfaces) {
      expect(source(file), `${file} still mounts an editor`).not.toMatch(/MonacoCodeEditor/);
    }
  });

  it('[FR-GIT-430] should offer no edit-mode toggle or save indicator in the diff header', () => {
    const header = source('diff-header.tsx');

    expect(header).not.toMatch(/editorMode|SaveStatus|saveStatus/);
  });

  it('[FR-GIT-430] should expose no content-write callback on the viewer', () => {
    // `onChange` was how edits left the pane; a review surface has no such exit.
    expect(source('diff-viewer-panel.tsx')).not.toMatch(/onChange\?:/);
  });
});

/**
 * The viewer keeps two pieces of state that outlive a render but must not
 * outlive a selection. It is not remounted per file — `diffs-page.tsx` and
 * `dir-diff-panel.tsx` both hold one instance — so nothing resets them for free.
 */
describe('diff viewer state is scoped to its selection', () => {
  const viewer = source('diff-viewer-panel.tsx');

  it('[FR-GIT-350] should clear the open comment composer when the selection changes', () => {
    // A composer left open carries the previous file's ChangeData, and
    // `getChangeKey` has no file identity — so it can resurface over an
    // unrelated line and save that file's text against this one.
    expect(viewer).toMatch(/selectionKey !== prevSelectionKey/);
    expect(viewer).toMatch(/setNewCommentChange\(null\)/);
  });

  it('[FR-GIT-400] should not restore scroll position when only the hunks change', () => {
    // Expanding a collapsed gap produces new hunks. Restoring on every hunks
    // change would snap the viewport to the top mid-review, so the restore is
    // gated on the selection actually having changed.
    expect(viewer).toMatch(/restoredKey\.current === selectionKey\) return/);
  });
});
