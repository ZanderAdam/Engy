---
subtype: decision
title: Close the key rail while composing rather than arbitrating paint order
keywords:
  - mobile-composer
  - mobile-terminal-controls
  - aria-modal
  - z-20
  - stacking context
  - ResizeObserver
  - PTY resize
themes:
  - mobile
  - terminal
  - z-index
tags:
  - ui
  - terminal
  - mobile
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/decisions/20260801213110-mobileidentitybar-mounts-at-three-sites-to-stay-inside-mobil.md
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
  - >-
    memory/decisions/20260801213130-mobile-terminal-input-goes-through-a-compose-overlay-not-xte.md
  - >-
    memory/insights/20260801213139-terminal-paste-reads-the-cli-host-s-clipboard-a-mobile-paste.md
  - >-
    memory/facts/20260801213147-bottom-anchored-mobile-controls-need-no-js-keyboard-avoidanc.md
  - >-
    memory/conventions/20260801213201-terminal-pane-surfaces-hardcode-zinc-and-get-restyled-by-att.md
scenarioIds: []
---
**Rule:** On the mobile terminal pane, remove coexistence rather than arbitrate paint order — close the extra-key column and disable its toggle while the composer is open. Any new mobile affordance there must state whether it can coexist with the composer.

**Why:** the compose overlay (`mobile-composer.tsx`) and the key rail (`mobile-terminal-controls.tsx`) are not in a parent/child paint relationship. The overlay is `absolute inset-0` inside the terminal-pane div and covers only that pane; the rail is its sibling in `terminal.tsx`'s flex row and stays visible and tappable beside it. Both carry `z-20` in the same root stacking context (no ancestor establishes one), so DOM order decides — and the rail comes later. The composer's `aria-modal="true"` does not make it exclusive.

**Evidence:** both obvious fixes are wrong. Raising the overlay to `z-30` ties with `bottom-terminal-toggle.tsx`'s `fixed … z-30`, which sits geometrically over the same bottom-right corner as the overlay's Send button — trading one DOM-order coin flip for another. Unmounting the rail while composing widens the `flex-1 min-w-0` pane, firing the ResizeObserver and costing a PTY resize plus full TUI redraw on every compose open/close — the exact cost the panel's absolute positioning was chosen to avoid.
