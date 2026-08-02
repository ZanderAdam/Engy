---
subtype: convention
title: 'Gate per-tab Radix overlays on tab.isActive — portals escape display:none'
keywords:
  - useOptionalTab
  - tab.isActive
  - TabPanel
  - Radix portal
  - 'display:none'
  - OpenTabsPicker
  - mobile-terminal-sheet
themes:
  - mobile
  - tabs
  - ui-conventions
tags:
  - ui
  - frontend
  - mobile
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/conventions/20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/insights/20260801212935-tooltipprovider-is-not-global-components-outside-the-project.md
  - >-
    memory/decisions/20260801213110-mobileidentitybar-mounts-at-three-sites-to-stay-inside-mobil.md
scenarioIds: []
---
**Rule:** Every per-tab Radix Sheet/Dialog mounted inside a TabPanel must gate its `open` on `tab.isActive` (via `useOptionalTab`). Queued `terminal:open`-style events must likewise be dropped in inactive tabs, or they replay stale on activation.

**Why:** the overlay renders through a `document.body` portal, so it escapes the tab's `display:none` entirely — a hidden tab's overlay covers the newly activated tab. Compounding it, the hidden tab's MobileHeader measures `offsetHeight` 0, so any headerHeight-offset overlay collapses to `top:0` full-screen.

**Evidence:** the mobile "project selector" bug reports actually came from the OpenTabsPicker — the prominent header dropdown shows the project name, so users called tab switching "changing project". The in-tab ProjectSwitcher path was already fixed by the scope-change close effect; the tabId event guard did not cover an already-open sheet surviving a tab switch.
