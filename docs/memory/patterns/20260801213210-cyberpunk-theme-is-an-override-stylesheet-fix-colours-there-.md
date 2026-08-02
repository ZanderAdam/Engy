---
subtype: pattern
title: >-
  Cyberpunk theme is an override stylesheet — fix colours there, not in
  components
keywords:
  - cyberpunk-theme.css
  - data-slot
  - useThemeFlavor
  - ITheme
  - IStandaloneThemeData
  - clip-path
  - Tailwind v4
themes:
  - theming
  - css
tags:
  - ui
  - theming
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** When a surface shows wrong colours under the cyberpunk flavor, add a remap rule to `web/src/app/cyberpunk-theme.css`, not a component edit. Components stay flavor-agnostic.

**Why:** the flavor is implemented entirely as an override stylesheet loaded after Tailwind utilities so `!important` wins. It targets `data-slot` attributes, roles, and — deliberately — Tailwind utility class names (`.text-blue-500`, `.bg-foreground`, `.group\/task`, `p.py-4.text-center`). Overriding utility classes by name feels like a smell but is the least-invasive pattern here; the alternative (semantic tokens everywhere) would change the default dark look, which is tuned independently.

**Connects to:** the exceptions are surfaces with programmatic themes — xterm's `ITheme` in `use-xterm-theme.ts` and Monaco's `IStandaloneThemeData` in `monaco-theme.ts` — which need explicit flavor switches via `useThemeFlavor()`. Two adjacent CSS gotchas in this theme: `clip-path` clips borders and box-shadow (bevel hairlines go via a rotated `::after`, glow via `filter: drop-shadow`), and Tailwind v4 making `translate` a separate property is what keeps transform animations safe on Radix-centered dialogs.
