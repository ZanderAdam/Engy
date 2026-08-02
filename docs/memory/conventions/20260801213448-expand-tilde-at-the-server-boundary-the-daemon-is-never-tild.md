---
subtype: convention
title: Expand tilde at the server boundary — the daemon is never tilde-aware
keywords:
  - expandTilde
  - os.homedir
  - dispatchCreateDir
  - GIT_INIT_REQUEST
  - initGitRepo
  - createMissingDirs
  - docsDir
themes:
  - path-handling
  - workspace-creation
tags:
  - architecture
  - daemon
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Expand `~` at the SERVER boundary via `expandTilde` (exported from `web/src/server/db/client.ts`). Apply it in the workspace router create/update so the DB stores the absolute form, and in the dispatch layer (`dispatchValidation`/`dispatchCreateDir`/`dispatchGitInit`) so neither the UI pre-check nor the daemon ever sees a literal `~`. Never make the daemon tilde-aware.

**Why:** a literal `~` passed through to the daemon's `mkdir(p)` and the server's `fs.mkdirSync(dir)` produces a literal `~` folder relative to each process's cwd. The bug presents as "missing directories" — the real `$HOME/...` path looks empty and it reads like a race condition — when in fact the dirs exist under a stray `~` folder. Expansion uses the server's `os.homedir()`, which is correct because a custom `docsDir` is written directly by the server, implying server/daemon co-location under the single-user local model. `expandTilde` is idempotent, so double application along the path's journey is safe.

**Connects to:** brand-new repo dirs created via `createMissingDirs` are also `git init`'d (`GIT_INIT_REQUEST` → daemon `initGitRepo`, which does init plus an empty initial commit so `git worktree add` has a born HEAD, and skips paths already inside a repo). A `docsDir` inside a repo still gets its own nested repo via `ensureGitRepo`.
