---
subtype: convention
title: ScrollArea in a flex column needs min-h-0 plus the viewport block override
keywords:
  - ScrollArea
  - min-h-0
  - flex-1
  - scroll-area-viewport
  - Radix
  - overflow-hidden
themes:
  - layout
  - ui-conventions
tags:
  - ui
  - frontend
sources: []
linkedMemories:
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
scenarioIds: []
---
**Rule:** A `<ScrollArea>` used as a flex-column child must carry `flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block`. A bare `flex-1` is the bug signature — grep for it.

**Why:** `flex-1` sets `flex-basis: 0` but leaves `min-height: auto`, so the Radix ScrollArea Root is floored at its content's min-content height and grows past the panel. The nearest `overflow-hidden` ancestor then clips the overflow with no scrollbar, and rows below the fold become unreachable. The second class overrides the `display: table` Radix puts on the viewport's inner wrapper, which otherwise max-content-sizes children and defeats line-clamp/truncation. The failure is invisible in code review: the markup looks correct, `overflow-hidden` is present on the right ancestors, the component renders, nothing errors — the list just ends.

**Evidence:** measured on the memory sidebar — root height 1971px and unscrollable without `min-h-0`, 766px and scrollable with it, same DOM otherwise.

**Connects to:** the one legitimate non-conformer is `web/src/components/memory/memory-detail.tsx`, which uses `shrink-0 max-h-40` — a deliberately height-capped panel that is not a flex-grow child, so the `min-height: auto` collapse never applied. Do not "fix" that one. Since the pair is now hand-repeated at 9 call sites, folding `min-h-0` into the primitive is worth weighing against the repo's rule of keeping `components/ui/` close to upstream shadcn.

**Contradicts:** grepping for `<ScrollArea` alone to audit call sites — multi-line JSX puts className on the following line, so a single-line grep reports false positives. Match on the `data-slot=scroll-area-viewport` string or read the element.
