---
subtype: convention
title: Hit-test z-index in nested overlays instead of comparing class literals
keywords:
  - elementFromPoint
  - stacking context
  - SheetContent
  - 'z-[60]'
  - Radix portal
  - 'modal={false}'
themes:
  - mobile
  - z-index
  - testing
tags:
  - ui
  - frontend
  - mobile
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/patterns/20260801212739-monaco-diffeditor-needs-per-file-model-paths-and-scrolltop-o.md
  - >-
    memory/conventions/20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md
scenarioIds: []
---
**Rule:** When reviewing z-index inside a portaled or nested overlay, hit-test with `document.elementFromPoint()` rather than comparing the numbers in the class names. Nesting decides the outcome, not the literals.

**Why:** a `z-[60]` inline `fixed inset-0` inside a Radix `SheetContent` does NOT out-rank a body-portaled dialog, because `SheetContent` is `fixed z-50` and therefore opens its own stacking context — the `z-[60]` is scoped *inside* the sheet. An `AlertDialog` portaled to `document.body` at `z-50` still paints above it, winning the tie at the root context by being later in body DOM order.

**Evidence:** verified empirically on a 420x860 viewport — `elementFromPoint()` at the dialog's own coordinates returned a node inside the dialog, and a screenshot showed the confirm dialog fully visible over the list. Reading the raw class names invites the opposite conclusion (60 > 50 ⇒ dialog hidden), and a code reviewer flagged it as a CRITICAL soft-lock on that basis.

**Connects to:** the comment above that overlay claims the list must stay inline because "the mobile sheet's Radix dialog disables pointer events on everything outside it" — but `mobile-terminal-sheet.tsx` sets `modal={false}` precisely to avoid that. The stated rationale is at best imprecise; the real hazard was taps falling through to the terminal and popping the keyboard.
