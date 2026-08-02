---
subtype: convention
title: The relay sync no-browser branch must do full worker teardown
keywords:
  - failWorkerDispatches
  - disconnectWorker
  - terminal_list_workers
  - terminal_spawn
  - relay sync
  - destroyed broadcast
themes:
  - terminal
  - lifecycle
tags:
  - terminal
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** The relay sync handler's no-browser cleanup branch must do full worker teardown — `failWorkerDispatches` + `disconnectWorker` + a `destroyed` broadcast — not merely delete the session meta.

**Why:** that branch is the death path for ALL agent-spawned terminals, since they never have a browser.

**Evidence:** the original cleanup only deleted `terminalSessionMeta`/`terminalSessions`, which was harmless before `terminal_spawn` existed because browserless sessions were rare transients. Agent-spawned workers turned the leak — phantom `alive:false` workers in `terminal_list_workers`, dispatches that never settle — into a guaranteed occurrence on every daemon reconnect.
