---
subtype: convention
title: >-
  Full-screen mobile overlays use z-[60] and Tailwind breakpoints, not
  useIsMobile
keywords:
  - 'z-[60]'
  - useIsMobile
  - 'max-md:'
  - Radix portal
  - z-50
  - hydration flash
themes:
  - mobile
  - ui-conventions
  - z-index
tags:
  - ui
  - frontend
  - mobile
sources: []
linkedMemories:
  - >-
    memory/insights/20260801212935-tooltipprovider-is-not-global-components-outside-the-project.md
  - >-
    memory/conventions/20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/patterns/20260801212739-monaco-diffeditor-needs-per-file-model-paths-and-scrolltop-o.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
scenarioIds: []
---
**Rule:** Full-screen mobile overlays in `web/` must use `z-[60]` and responsive Tailwind classes (`max-md:`/`md:`), never a `useIsMobile` JS branch.

**Why:** all Radix portals (Tooltip/Popover/Dialog) render at `z-50`, so anything below 50 gets pierced by portaled UI — an overlay that looks fine in isolation sits under every portal. And `useIsMobile` returns false on the server, so a JS viewport branch causes a visible desktop-to-mobile layout flash on hydration; CSS breakpoints apply before JS runs. Tailwind's `md` is 768px, exactly `useIsMobile`'s breakpoint, so the swap is behaviour-preserving.

**Connects to:** precedent is `terminal-dock-actions.tsx` (`fixed inset-0 z-[60]`). Note that a raw z-index number is not the whole story once stacking contexts nest — a `z-[60]` inside a `fixed z-50` sheet is scoped to that sheet and loses to a body-portaled dialog.
