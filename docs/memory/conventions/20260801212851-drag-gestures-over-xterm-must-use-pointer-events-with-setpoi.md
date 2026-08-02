---
subtype: convention
title: Drag gestures over xterm must use pointer events with setPointerCapture
keywords:
  - setPointerCapture
  - pointer events
  - touch-action
  - xterm-rows
  - pointercancel
  - iOS Safari
themes:
  - mobile
  - terminal
  - testing
tags:
  - terminal
  - frontend
  - mobile
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Any drag gesture over xterm content must use pointer events plus `setPointerCapture`, never touch events. `touch-action` must also forbid panning — `pinch-zoom` is the narrowest value that works.

**Why:** the finger lands on a `<span>` inside `.xterm-rows`. The first line scrolled makes xterm's DOM renderer rebuild that row and destroy the span, and iOS Safari then stops delivering the gesture — the drag moves one line and dies. Row `<div>`s are reused but their span children are not, so "the target is stable" is false. Without the `touch-action` restriction the browser claims the gesture and fires `pointercancel`.

**Evidence:** Chrome retargets events to detached nodes and keeps the gesture alive, so a playwright/CDP verification in mobile-emulated Chrome PASSES while the real phone fails. A touch-event implementation was shipped, verified green, and rejected by the user on device. Emulated Chrome cannot falsify this class of bug.

**Connects to:** verify DOM-churn-sensitive gestures by asserting the event target retargets to the captured element (`retargetedToContainer === moveCount`), not merely that `scrollTop` changed — that assertion would have caught this in emulation.
