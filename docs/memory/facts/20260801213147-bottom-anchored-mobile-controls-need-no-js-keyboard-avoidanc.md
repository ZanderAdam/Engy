---
subtype: fact
title: Bottom-anchored mobile controls need no JS keyboard avoidance
keywords:
  - interactiveWidget
  - resizes-content
  - use-keyboard-inset
  - visual viewport
  - iOS Safari 17.4
themes:
  - mobile
  - viewport
  - keyboard
tags:
  - ui
  - frontend
  - mobile
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Do not add JS keyboard-avoidance to bottom-anchored mobile controls. `web/src/app/layout.tsx` sets `interactiveWidget: 'resizes-content'`, so the layout viewport shrinks with the on-screen keyboard and bottom-anchored UI rides up on its own.

**Why:** `use-keyboard-inset.ts` exists only as a fallback for engines that ignore that hint (iOS Safari before 17.4), which shrink the visual viewport alone. This makes the hook read 0 on every modern engine including Chrome DevTools' device mode — which looks exactly like a broken hook. Anyone debugging "keyboardInset is always 0" will chase a non-bug without knowing about the layout.tsx setting.

**Connects to:** the hook measures against the WINDOW bottom, so callers must themselves be window-bottom-anchored. A caller sitting higher gets over-padded, which is safe (never hidden) — that is why the mobile compose overlay can use it while living inside the terminal pane rather than fixed to the window.
