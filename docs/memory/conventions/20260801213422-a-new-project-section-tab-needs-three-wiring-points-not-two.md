---
subtype: convention
title: 'A new project section tab needs three wiring points, not two'
keywords:
  - sections.ts
  - dispatchProject
  - tab-content.tsx
  - NotFound
  - project section tab
themes:
  - tabs
  - routing
tags:
  - ui
  - frontend
sources: []
linkedMemories:
  - >-
    memory/patterns/20260801213415-route-every-tab-path-change-through-navigateorreusetab.md
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/facts/20260801213147-bottom-anchored-mobile-controls-need-no-js-keyboard-avoidanc.md
scenarioIds: []
---
**Rule:** Adding a project section tab requires THREE wiring points: the `sections.ts` registry entry, the app route `page.tsx`, AND a `case '<segment>'` in `dispatchProject` (`web/src/components/tabs/tab-content.tsx`).

**Why:** with the third missing, the route builds and typechecks cleanly but renders the NotFound fallback. `pnpm build`, `tsc`, and all unit tests stay green — only an actual browser navigation catches it.

**Connects to:** the virtual tab system (tab-context/tab-content); applies to any future project tab.
