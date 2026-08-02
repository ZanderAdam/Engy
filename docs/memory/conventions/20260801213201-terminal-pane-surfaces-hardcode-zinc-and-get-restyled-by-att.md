---
subtype: convention
title: Terminal-pane surfaces hardcode zinc and get restyled by attribute selector
keywords:
  - cyberpunk-theme.css
  - aria-label
  - attribute selector
  - zinc
  - bg-background
  - terminal pane
themes:
  - theming
  - terminal
tags:
  - ui
  - theming
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801213120-close-the-key-rail-while-composing-rather-than-arbitrating-p.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
scenarioIds: []
---
**Rule:** Adding a themed surface to the terminal pane is a two-file change: hardcode the zinc colours in the component, then add a matching override block in `web/src/app/cyberpunk-theme.css` keyed on an attribute selector (`[role='toolbar'][aria-label='Terminal keys'] button`, `button[aria-label='Compose message']`, `[role='dialog'][aria-label='Compose terminal message']`).

**Why:** the pane is always dark because xterm sits underneath, which is why token conversion was rejected — `bg-background` would go white in light mode over a dark terminal. The consequence is that any NEW hardcoded-zinc surface is invisible to the theme until its override block exists, and because the selectors key off `aria-label`, renaming an aria-label silently unthemes the element.

**Connects to:** the wider cyberpunk convention of overriding from a stylesheet rather than editing components.
