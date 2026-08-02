---
subtype: pattern
title: Monaco DiffEditor needs per-file model paths and scrollTop-only restore
keywords:
  - DiffEditor
  - originalModelPath
  - restoreViewState
  - hideUnchangedRegions
  - onDidUpdateDiff
  - hasTextFocus
  - executeEdits
themes:
  - editor
  - diffs
tags:
  - ui
  - frontend
sources: []
linkedMemories:
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/conventions/20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md
scenarioIds: []
---
**Rule:** Always pass `originalModelPath`/`modifiedModelPath` to `@monaco-editor/react`'s DiffEditor, and preserve view state as `modifiedEditor.getScrollTop()`/`setScrollTop()` only — never `restoreViewState`.

**Why:** Two distinct failures, both absent from the single-file `Editor`. Without model paths the DiffEditor reuses ONE shared model across files (empty-path URI) and rewrites it on each switch via `executeEdits`, which fires `onDidChangeModelContent` — the same event user typing fires. Auto-save wired to that event therefore persists a programmatic content-swap of the newly-selected file INTO the previously-selected file's path. Separately, the DiffEditor does not persist view state across model swaps at all, and restoring a full `IDiffEditorViewState` throws `Illegal value for lineNumber` (at `getBottomForLineNumber`) when `hideUnchangedRegions` is on, because the restored line lands in a collapsed region. That throw is ASYNC — it happens during a later layout pass — so a try/catch around `restoreViewState` cannot catch it. `setScrollTop` is pixel-based, clamps internally, and never throws.

**Evidence:** measured via playwright-cli — full `restoreViewState` produced 16 uncaught errors on rapid switching, scrollTop-only produced 0. Deferring restore to `onDidUpdateDiff` plus try/catch still did not stop it; full view-state restore is fundamentally incompatible with `hideUnchangedRegions`. Verified against `@monaco-editor/react@4.7.0` dist source: `executeEdits` (not `setValue`) is what the library uses for the modified side, so `IModelContentChangedEvent.isFlush` is always false and cannot discriminate swaps from edits.

**Connects to:** the robust edit-vs-swap discriminator is `modifiedEditor.hasTextFocus()` — a programmatic swap happens while blurred (focus moved to the clicked file), a genuine edit is always focused. Restore on `onDidUpdateDiff` so the collapsed layout has settled; save the outgoing file's scrollTop in the effect CLEANUP, since React runs all cleanups before any setup and therefore before the library swaps models. The code editor already did per-file paths via its `path` prop; the diff editor never had them.
