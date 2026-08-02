---
subtype: decision
title: MobileIdentityBar mounts at three sites to stay inside MobileOverlayProvider
keywords:
  - MobileIdentityBar
  - MobileOverlayProvider
  - useOptionalMobileOverlay
  - headerHeight
  - TabPanel
  - MobileHeader
themes:
  - mobile
  - layout
  - react-context
tags:
  - ui
  - frontend
  - mobile
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/conventions/20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md
  - >-
    memory/insights/20260801212935-tooltipprovider-is-not-global-components-outside-the-project.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
scenarioIds: []
---
**Rule:** Keep `MobileIdentityBar` mounted at its three separate sites (HomePage, the workspace layout's non-project branch, MobileHeader). Do not hoist it into TabShell/TabPanel for a single mount.

**Why:** it must render *inside* `MobileOverlayProvider` to publish `headerHeight`. The provider is created inside the workspace layout's mobile branch, so a bar mounted above it gets a null context, `headerHeight` stays 0, and the full-screen terminal sheets cover the bar — reintroducing the exact "no way to switch tabs" problem the bar exists to solve. `useOptionalMobileOverlay` is what makes the three-site version safe: the bar degrades to not publishing height on the workspace-picker screen (no provider, and no overlays there) while still publishing on workspace and project routes.

**Connects to:** hoisting `MobileOverlayProvider` up to TabPanel would enable the single-mount version, but the terminal sheets it feeds need workspace-scoped context, so that refactor is larger than it looks.
