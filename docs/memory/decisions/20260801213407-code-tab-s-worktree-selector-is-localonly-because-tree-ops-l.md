---
subtype: decision
title: >-
  Code tab's worktree selector is localOnly because tree ops lack coderWorkspace
  routing
keywords:
  - WorktreeSelector
  - localOnly
  - coderWorkspace
  - file.listDir
  - searchRepoFiles
  - useProjectWorktreeMap
themes:
  - worktrees
  - code-browsing
tags:
  - ui
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Keep the Code tab's `WorktreeSelector` restricted to LOCAL worktrees via its `localOnly` prop. Do not copy the Diffs page's unrestricted selector.

**Why:** the Code tab's file TREE reads through `file.listDir` and `dir.searchRepoFiles`, which have NO `coderWorkspace` routing — only `file.read`/`readImage`/`write` do. A Coder worktree would appear in the selector and then produce an empty or broken tree.

**Evidence:** Diffs can show Coder worktrees safely because it never enumerates a full tree — it lists changed files via git ops (`getStatus`/`getBranchDiff`), which DO carry `coderWorkspace`.

**Connects to:** both tabs share the worktree-switch pattern — a per-repo `WorktreeSelector` returning `WorktreeSelection {worktreePath, coderWorkspace?}`, gated by `useProjectWorktreeMap` so a project-level `?wt` overrides the local pick. Browsing a remote Coder worktree's full tree would require adding `coderWorkspace` to the dir-list/search WS dispatch and daemon handlers.
