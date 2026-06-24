---
subtype: insight
title: >-
  Turbopack dev cache corruption crashes web but daemon keeps reconnecting (rm
  web/.next/dev/cache)
repo: engy
keywords:
  - turbopack
  - .next/dev/cache
  - .sst
  - ERR_CONNECTION_REFUSED
  - ws=down
  - '1006'
  - corrupted database
themes:
  - dev-environment
tags:
  - dev-environment
  - gotcha
sources: []
linkedMemories:
  - >-
    memory/insights/20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md
  - >-
    memory/insights/20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
  - >-
    memory/insights/20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
scenarioIds: []
---
**Core claim:** The Next 16 (turbopack canary) `pnpm dev` web server can crash mid-session with a Rust panic that corrupts the persistent dev cache: `Failed to restore task data (corrupted database or bug)` → `Unable to open static sorted file 00000XXX.sst: No such file or directory`.

**What surprised:** The web process dies but the client daemon keeps reconnecting (`ws=down`, `code=1006`), so `pnpm dev` looks alive while the browser only gets `ERR_CONNECTION_REFUSED` — easy to misread as a code bug. It is the turbopack persistent dev cache that's corrupt, not your code. Recovery: kill the dev process tree (e.g. `kill $(lsof -t <dev-log>)`), `rm -rf web/.next/dev/cache`, then `pnpm dev` again (it picks a fresh free port — read the new `Ready on`/`[dev]` log line). Clearing just `.next/dev/cache` is enough; no need to nuke all of `.next`.

**Connects to:** running the dev server with plain `pnpm dev` (auto-port); daemon reconnect / `ws=down` symptoms; this also lives in harness memory (turbopack-dev-cache-corruption) but is duplicated here so it survives in the workspace knowledge layer.

**Contradicts:** nothing identified.

Session: session 2026-06-23
