---
subtype: pattern
title: Route every tab path change through navigateOrReuseTab
keywords:
  - navigateOrReuseTab
  - projectTabKey
  - pushVirtual
  - updateTabPath
  - computeInitialTabs
  - openNewTab
themes:
  - tabs
  - navigation
tags:
  - ui
  - frontend
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/facts/20260801213147-bottom-anchored-mobile-controls-need-no-js-keyboard-avoidanc.md
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
scenarioIds: []
---
**Rule:** Route ALL tab path changes through a pure helper (`navigateOrReuseTab`) that focuses an existing tab with the same `projectTabKey` (workspace/project@worktree) instead of navigating in place. Leave the origin tab untouched so home and workspace pages act as launchers.

**Why:** dedup that only covers `openNewTab` and initial load (`computeInitialTabs`) misses plain-click navigation. `pushVirtual → updateTabPath` silently re-points the current tab, so a home → workspace → project click-through duplicates an already-open project tab. That was the root cause of the duplicate-tabs reports.

**Connects to:** the workspace selection page (`/`) is the only route with no open-tab affordance on mobile — TabStrip is desktop-only, and MobileHeader plus OpenTabsPicker mount only in the project layout — which is why it carries an on-page "Open Projects" section.
