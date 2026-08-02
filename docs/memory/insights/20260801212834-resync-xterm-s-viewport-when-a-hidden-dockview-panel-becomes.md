---
subtype: insight
title: Resync xterm's Viewport when a hidden dockview panel becomes visible
keywords:
  - xterm
  - Viewport
  - syncScrollArea
  - ydisp
  - _ignoreNextScrollEvent
  - dockview
  - onDidVisibilityChange
  - scrollback
themes:
  - terminal
  - scrolling
tags:
  - terminal
  - frontend
sources: []
linkedMemories:
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
scenarioIds: []
---
**Rule:** When a dockview panel with `renderer: 'always'` becomes visible again, force an xterm Viewport resync — `scrollback = N±1` then back, or a `scrollLines(-1)`/`scrollLines(+1)` pair. A same-value poke is a no-op.

**Why:** while the panel is hidden with `display:none`, PTY writes keep advancing `buffer.ydisp`, but `Viewport._innerRefresh`'s `.xterm-viewport.scrollTop` assignments are silent no-ops (no layout box) and leave `_ignoreNextScrollEvent` stuck true, with scroll-area height computed against `offsetHeight = 0`. Nothing resyncs on re-show: `Terminal.resize` early-returns on unchanged dims so `_afterResize → syncScrollArea(true)` never runs, and `refresh()` only repaints. The first user wheel-up then maps the stale DOM `scrollTop` to a buffer row (`newRow - ydisp`), teleporting the viewport back to the frame visible before the tab was hidden — which in repaint-heavy TUI scrollback looks like "the same screen repeating". There is no public `syncScrollArea`, and `OptionsService` only fires `onSpecificOptionChange` on a real value change, which is why the poke must actually change the value.

**Evidence:** the screen renders correctly after re-show (the renderer paints from the buffer, not `scrollTop`), so the desync is invisible until the first scroll; and any new PTY output after re-show heals it via buffer scroll → `syncScrollArea`. The bug therefore only bites idle terminals, making it look intermittent.

**Connects to:** dockview's `overlayRenderContainer` hides via `display:none` and its comment wrongly implies scroll state is fully preserved. xterm 5.5's `Viewport._handleScroll` offsetParent guard only protects while hidden, not after.
