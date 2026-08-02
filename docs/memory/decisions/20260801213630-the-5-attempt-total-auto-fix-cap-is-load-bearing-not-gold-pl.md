---
subtype: decision
title: 'The 5-attempt total auto-fix cap is load-bearing, not gold-plating'
keywords:
  - auto-fix cap
  - head SHA
  - classifyGhError
  - prRepoErrors
  - maybeDispatchCiFix
  - PR monitoring
themes:
  - pr-monitoring
  - safety-limits
tags:
  - architecture
  - agents
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Keep the total cap of 5 auto-fix attempts per PR, alongside the 2-per-head-SHA cap. Do not remove it as redundant.

**Why:** each fix-push resets the per-SHA counter, so only the total cap bounds fix-push loops. Without it the per-SHA limit is unbounded in practice.

**Connects to:** the surrounding PR-monitoring design was deliberately simplified on KISS grounds — no auth-status preflight op (errors are typed per gh call by `classifyGhError`), no PR state column (vanished rows are deleted, since `gh pr list` is open-only), CI classification by check names only with logs fetched after gates for prompt context, and per-repo gh errors surfaced via `AppState.prRepoErrors` rather than a global banner (which is reserved for gh-not-installed or no-daemon).
