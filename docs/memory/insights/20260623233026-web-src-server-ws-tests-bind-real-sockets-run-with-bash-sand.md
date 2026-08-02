---
subtype: insight
title: web/src/server/ws tests bind real sockets — run with Bash sandbox disabled
repo: engy
keywords:
  - ws tests
  - server.listen
  - EPERM
  - sandbox
  - vitest hang
  - real sockets
themes:
  - testing
  - dev-environment
tags:
  - testing
  - sandbox
  - gotcha
sources: []
linkedMemories:
  - >-
    memory/insights/20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md
  - >-
    memory/insights/20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md
  - >-
    memory/insights/20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
  - >-
    memory/insights/20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md
  - >-
    memory/conventions/20260801212900-verify-a-regression-test-fails-for-the-reason-you-think-not-.md
  - >-
    memory/conventions/20260801213001-assert-mcp-zod-constraints-against-the-schema-not-through-ca.md
scenarioIds: []
---
web/src/server/ws/*.test.ts suites bind real sockets (server.listen) — under the Claude Code Bash sandbox they fail with EPERM and vitest hangs ~15min instead of failing fast. Always run these suites with sandbox disabled; an empty/silent vitest output file is the telltale.
