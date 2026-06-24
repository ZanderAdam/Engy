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
linkedMemories: []
scenarioIds: []
sources: []
---
When multiple dev servers run across worktrees, port 3000 may belong to a different worktree (prod) than the one you intend to test. Before browser-testing, map listeners to their working trees so you don't validate the wrong code:

```
lsof -nP -iTCP -sTCP:LISTEN          # find listening pids/ports
lsof -p <pid> | awk '$4=="cwd"'      # map each pid to its worktree cwd
```

Related: [[pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-]] (same multi-worktree dev-environment hazard).
