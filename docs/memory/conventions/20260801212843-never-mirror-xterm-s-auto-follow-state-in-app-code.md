---
subtype: convention
title: Never mirror xterm's auto-follow state in app code
keywords:
  - isUserScrolling
  - BufferService
  - scrollToBottom
  - scrollLines
  - ydisp
  - ybase
themes:
  - terminal
  - scrolling
tags:
  - terminal
  - frontend
sources: []
linkedMemories:
  - >-
    memory/insights/20260801212834-resync-xterm-s-viewport-when-a-hidden-dockview-panel-becomes.md
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
scenarioIds: []
---
**Rule:** Never mirror xterm's auto-follow state in application code. `BufferService.isUserScrolling` is already the single source of truth — `scroll()` only advances `ydisp` while it is false, `scrollLines(negative)` sets it, and any scroll reaching `ybase` clears it.

**Why:** a parallel "isPinned" flag plus a forced `term.scrollToBottom()` after writes is actively harmful, because `scrollToBottom()` calls `scrollLines(ybase - ydisp)`, which RESETS `isUserScrolling` — so every frame of streaming output wipes the user's scroll-up.

**Evidence:** this bug was iterated on three times (8f9e542, 5a31a03) by refining the mirror rather than deleting it. The mirror could never be correct on mobile regardless: it was only ever unpinned by wheel events, which touch devices do not fire.

**Connects to:** the one place a nudge is still needed is an upward wheel from the bottom (force `scrollLines(-1)`) — while following, each write resets the viewport, so sub-line trackpad deltas never accumulate into a scroll on their own.
