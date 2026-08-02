---
subtype: convention
title: 'Mutate worktrees at the path git reports, never a recomputed canonical path'
keywords:
  - worktree.listGrouped
  - worktree.remove
  - dispatchGitWorktreeList
  - getProjectWorktreeDir
  - git worktree list
themes:
  - worktrees
  - git
tags:
  - architecture
  - git
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Any worktree *mutation* must target the path `git worktree list` actually reports, resolved via `dispatchGitWorktreeList` and matched by branch — never a path recomputed from `getProjectWorktreeDir(...)`. Only create/sync may compute a canonical path, because they are creating it.

**Why:** `worktree.listGrouped` surfaces EVERY non-main worktree of each repo straight from git, so `.claude/worktrees/*` agent trees, `engy-worktrees/*`, and any manually-added worktree all appear in the Manage Worktrees dialog — not just the ones Engy created.

**Evidence:** `worktree.remove` recomputed the canonical Engy path and passed it to `git worktree remove`. For every worktree not physically at that location git failed with `fatal: '<path>' is not a working tree` (classified OTHER), surfacing as a bare "Remove failed" with no detail — invisible in web and daemon logs because the daemon returns the error over WS rather than logging it. A clean Engy-created create+remove succeeds, which is why it looked intermittent.
