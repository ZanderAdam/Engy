---
subtype: insight
title: >-
  Parallel Workflow agents sharing a git worktree can silently wipe uncommitted
  work
repo: engy
keywords:
  - Workflow
  - parallel agents
  - worktree
  - isolation
  - drizzle-kit generate
  - untracked files
  - filesChanged
themes:
  - multi-agent
  - dev-environment
tags:
  - workflow
  - worktrees
  - gotcha
sources: []
linkedMemories: []
scenarioIds: []
---
Parallel Workflow agents editing the same git worktree can silently wipe each other's uncommitted work. In the T231/T271/T272 batch, the T271 agent (which ran drizzle-kit generate + git operations) wiped the T231 agent's new untracked files (web/src/lib/clipboard.ts) and its tracked-file edits, even though they touched disjoint files. Mitigation: give each parallel implementer agent isolation:'worktree', or run tasks that touch git/migrations sequentially, or have the orchestrator re-verify each agent's filesChanged actually exist on disk before validating.
