---
subtype: insight
title: >-
  web WS/search test suites flake under blt — need isolated ENGY_DIR +
  --no-file-parallelism
repo: engy
keywords:
  - repo-adapter.test.ts
  - validate.test.ts
  - ENGY_DIR
  - WORKSPACES_SYNC
  - GLOB_FILES_REQUEST
  - '--no-file-parallelism'
  - Daemon disconnected
themes:
  - testing
  - dev-environment
tags:
  - testing
  - flakiness
  - gotcha
sources: []
linkedMemories:
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
  - >-
    memory/insights/20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md
  - >-
    memory/insights/20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md
  - >-
    memory/insights/20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md
  - >-
    memory/insights/20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md
  - >-
    memory/conventions/20260801212900-verify-a-regression-test-fails-for-the-reason-you-think-not-.md
scenarioIds: []
---
web WS/search test suites (src/server/search/repo-adapter.test.ts, validate.test.ts) are environment-dependent: they read the ambient ENGY_DIR and connect to a real daemon WS. Under `pnpm blt` (turbo parallel load) they flake with 'Daemon disconnected' rejections and a WORKSPACES_SYNC-ordering race (the test expects GLOB_FILES_REQUEST as the daemon's first message, but a WORKSPACES_SYNC from the real ~/.engy DB with 6 workspaces lands first). They pass deterministically when run standalone with `--no-file-parallelism` and an isolated ENGY_DIR (ENGY_DIR=$TMPDIR/x/ pnpm vitest run --no-file-parallelism src/server/search src/server/ws).
