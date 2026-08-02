---
subtype: insight
title: >-
  TooltipProvider is not global — components outside the project layout must
  supply it
keywords:
  - TooltipProvider
  - shadcn
  - Tooltip
  - DirDiffPanel
  - FileListPanel
  - /open
themes:
  - ui-conventions
  - react-context
tags:
  - ui
  - frontend
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Any component using shadcn `<Tooltip>` that can render outside `web/src/app/w/[workspace]/projects/[project]/layout.tsx` must supply its own `<TooltipProvider>`. Nesting providers is safe, so wrap at the component that owns the tooltips rather than hunting every route.

**Why:** `TooltipProvider` is mounted only in that one layout, and `web/src/components/ui/tooltip.tsx` is the plain shadcn wrapper that does NOT auto-wrap a provider (newer shadcn versions do). Without one, the component throws "`Tooltip` must be used within `TooltipProvider`" and blanks the route. The failure is invisible to typecheck, lint, vitest and knip — only rendering the route catches it.

**Evidence:** grepping for `TooltipProvider` shows hits in the project layout and theme-toggle, which reads like "it's provided high up" — it is not. It surfaced when `FileListPanel` (diff screen) gained tooltips and the `/open` quick-diff route, which renders the same panel via `DirDiffPanel` outside the project layout, started crashing.

**Connects to:** the project convention of using shadcn Tooltip instead of the native `title` attribute. Shared diff components are reused by both `/w/.../diffs` and `/open`, so any provider-dependent primitive added to them needs the same treatment.
