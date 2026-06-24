---
subtype: insight
title: pnpm install at root can symlink @engy/common into the wrong worktree
repo: engy
keywords:
  - pnpm install
  - '@engy/common'
  - worktree
  - symlink
  - readlink
  - node_modules
  - has no exported member
themes:
  - dev-environment
  - monorepo
tags:
  - worktrees
  - pnpm
  - gotcha
  - dx
sources: []
linkedMemories:
  - >-
    memory/insights/20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
  - >-
    memory/insights/20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
  - >-
    memory/insights/20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md
scenarioIds: []
---
Running `pnpm install` at the repo root while another Claude session is active in a `.claude/worktrees/*` worktree can leave `client/node_modules/@engy/common` symlinked into the OTHER worktree's `common/` (e.g. `client/node_modules/@engy/common -> ../../../.claude/worktrees/m7-review-fixes/common`).

Symptom: `tsc` reports `@engy/common` "has no exported member" for types that clearly exist in `common/src`.

Fix: `readlink client/node_modules/@engy/common` to confirm the bad target, then re-run `pnpm install` at the root.
