---
subtype: pattern
title: Drive xterm scrolling yourself — its native wheel and touch paths both fail
keywords:
  - xterm
  - scrollLines
  - attachCustomWheelEventHandler
  - Viewport._innerRefresh
  - coreMouseService
  - isUserScrolling
  - ydisp
themes:
  - terminal
  - scrolling
tags:
  - terminal
  - frontend
sources: []
linkedMemories:
  - >-
    memory/insights/20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md
  - >-
    memory/patterns/20260623233015-terminal-spawn-gate-waiters-must-re-check-spawningsessions-i.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
scenarioIds: []
---
**Rule:** Never leave scrolling to xterm.js's native pipeline in an Engy terminal. Intercept wheel via `attachCustomWheelEventHandler` and touch via capture-phase handlers on the container, and drive `term.scrollLines()` directly.

**Why:** Both native paths are dead here, for different reasons. Wheel: `Viewport._innerRefresh` resets the DOM viewport `scrollTop` to `ydisp*rowHeight` on every animation frame during writes, wiping sub-line deltas before `Math.round(scrollTop/rowHeight)` can register a line — so slow trackpad scrolling is completely locked during heavy output and works fine when idle, which masks it. Touch: `Terminal.bindMouse()` opens both `touchstart` and `touchmove` with `if (this.coreMouseService.areMouseEventsActive) return;`, and every agent TUI (Claude Code, Codex) enables mouse reporting. Native browser scrolling does not cover for it either — only `.xterm-viewport` is scrollable and `.xterm-screen` overlays it, so a drag reaches the viewport only in the margins past the last row. That is the "I can only scroll by dragging empty space" symptom. `scrollLines()` mutates `ydisp` and sets `isUserScrolling`, both immune to the per-frame reset.

**Evidence:** the previous wheel fix (force `scrollLines(-1)` while pinned) looked correct and passed testing, but only covered the first wheel tick — every later tick died silently in the pixel path. For touch, the obvious culprit (xterm.js#3613) is a red herring: iOS-only, from 4.16, and #5489 says 5.5.0 worked. xterm binds touch on `this.element`, an ancestor of `.xterm-screen`, so the touch target was never the problem — mouse reporting was.

**Connects to:** the custom handler must return true (defer to xterm) for the alternate buffer, `mouseTrackingMode !== 'none'`, and shiftKey, and must mirror `scrollSensitivity`/`fastScrollModifier` since the native path is fully bypassed. Touch handlers need `stopPropagation` so xterm never double-scrolls. Carry sub-line remainders across wheel events. Note `Math.trunc(-0.x)` returns `-0`, which fails vitest `toBe(0)`.
