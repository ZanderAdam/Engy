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
linkedMemories:
  - >-
    memory/insights/20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md
  - >-
    memory/insights/20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
  - >-
    memory/insights/20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md
scenarioIds: []
---
Parallel Workflow agents editing the same git worktree can silently wipe each other's uncommitted work. In the T231/T271/T272 batch, the T271 agent (which ran drizzle-kit generate + git operations) wiped the T231 agent's new untracked files (web/src/lib/clipboard.ts) and its tracked-file edits, even though they touched disjoint files. Mitigation: give each parallel implementer agent isolation:'worktree', or run tasks that touch git/migrations sequentially, or have the orchestrator re-verify each agent's filesChanged actually exist on disk before validating.
