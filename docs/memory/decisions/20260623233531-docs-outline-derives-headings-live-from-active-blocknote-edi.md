---
subtype: decision
title: >-
  Docs outline derives headings live from active BlockNote editor block model,
  not saved markdown
repo: engy
keywords:
  - DocDockContext
  - publishOutline
  - usePanelOutline
  - BlockNote block id
  - data-id
  - scrollToHeading
  - Dockview isActive
  - renderer always
themes:
  - docs
  - editor
tags:
  - docs
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Core claim:** The docs outline (table of contents) derives headings live from the active BlockNote editor's block model — published up through DocDockContext to the page — chosen over parsing the active file's saved markdown at the page level.

**What surprised:** The simpler page-level markdown-parse approach has two failure modes that only surfaced in design discussion: it lags the editor's 1.5s autosave debounce (outline goes stale while typing), and scroll-to-heading must match by heading *index*, which breaks when a doc has duplicate heading text. The block-model approach sidesteps both — headings update on every keystroke, and each carries a BlockNote block id that maps 1:1 to a rendered `[data-id]` element for exact `scrollIntoView`. Forcing factor for the active-panel-publishes design: Dockview mounts every open doc tab at once (`renderer:'always'`), so multiple editors exist simultaneously and only the foreground panel may drive the sidebar (gated on the Dockview panel `api.isActive` / `onDidActiveChange`).

**Connects to:** DocDockManager / DocDockContext outline publishing (`publishOutline`); `usePanelOutline` active-panel gating; the BlockNote block-id ↔ `[data-id]` DOM contract used by `scrollToHeading`.

**Contradicts:** nothing identified.

Session: session 2026-06-23
