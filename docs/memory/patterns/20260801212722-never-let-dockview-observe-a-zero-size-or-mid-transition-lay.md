---
subtype: pattern
title: Never let dockview observe a zero-size or mid-transition layout
keywords:
  - dockview
  - dv-render-overlay
  - OverlayRenderContainer
  - api.layout
  - 'renderer: always'
  - ResizeObserver
  - animationend
themes:
  - layout
  - terminal
tags:
  - ui
  - frontend
  - terminal
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Never feed dockview a zero-size or mid-CSS-transition layout. Animate an outer clip wrapper while the inner dockview host keeps a fixed px size, and additionally self-heal with a forced `api.layout(w, h, true)` on ancestor `animationend`/`transitionend` and root ResizeObserver changes.

**Why:** With `renderer: 'always'`, panel content lives in absolutely-positioned overlay divs synced by rAF-deferred DOM measurements — dockview-core's `Resizable` defers ResizeObserver callbacks by one rAF carrying observation-time sizes, and `OverlayRenderContainer` adds a second rAF layer with a PositionCache and per-panel dedup. During an animated 0→W expand these stacked deferrals can apply a stale mid-transition size last, with no further event to correct it; xterm then faithfully fits into a sliver-sized overlay. Fixing the input kills the whole race class. But resize is not the only trigger: mounting during a pure entrance animation (the mobile terminal sheet mounts TerminalManager mid-slide-in) makes the overlay attach rAF measure a degenerate box, and since nothing resizes afterwards no dimension event ever corrects it — terminal stuck as a small square top-left. Forced layout heals universally because `DockviewPanel.layout` fires `onDidDimensionsChange` unconditionally.

**Evidence:** xterm-level refits — the earlier fix attempts, e.g. refit on tab switch — could never heal either case, because the stale element was dockview's `dv-render-overlay`, not xterm.

**Connects to:** the two triggers need opposite fixes. Resize-driven staleness is best removed at the source (clip-wrapper pattern); animation-driven attach staleness can only be healed after the fact, because mount-during-animation is inherent to the sheet UX. dockview-core's `Resizable` skips `display:none` via an offsetParent check, so project-tab display:none switches are safe. Side benefit of the clip wrapper: the PTY no longer thrashes to minimum rows on every dock collapse.

**Contradicts:** the intuition that mobile sheets are safe because transforms do not fire ResizeObservers — true, and that is exactly why they cannot self-correct.
