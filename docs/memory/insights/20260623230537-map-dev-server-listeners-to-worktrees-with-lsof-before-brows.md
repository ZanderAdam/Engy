---
subtype: insight
title: Map dev-server listeners to worktrees with lsof before browser-testing
repo: engy
keywords:
  - lsof
  - port 3000
  - worktree
  - dev server
  - browser-testing
  - listeners
  - cwd
themes:
  - dev-environment
  - testing
tags:
  - worktrees
  - gotcha
  - dx
linkedMemories:
  - >-
    memory/insights/20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
  - >-
    memory/insights/20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
scenarioIds: []
sources: []
---
When multiple dev servers run across worktrees, port 3000 may belong to a different worktree (prod) than the one you intend to test. Before browser-testing, map listeners to their working trees so you don't validate the wrong code:

```
lsof -nP -iTCP -sTCP:LISTEN          # find listening pids/ports
lsof -p <pid> | awk '$4=="cwd"'      # map each pid to its worktree cwd
```

Related: [[pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-]] (same multi-worktree dev-environment hazard).
