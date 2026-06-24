---
subtype: pattern
title: >-
  Terminal spawn-gate waiters must re-check spawningSessions in a loop after
  await
repo: engy
keywords:
  - spawningSessions
  - terminalSessionMeta
  - spawn gate
  - waiter
  - Strict Mode teardown
  - double-spawn
themes:
  - terminal
  - concurrency
tags:
  - terminal
  - concurrency
sources: []
linkedMemories: []
scenarioIds: []
---
Terminal spawn gate (spawningSessions): waiters must re-check the gate in a LOOP after awaiting, then classify on terminalSessionMeta. A single await + meta check either dead-ends the waiter when the original spawn was abandoned (Strict Mode teardown mid-container-start) or double-spawns when multiple waiters wake together. The fall-through-to-spawn path installs a new gate synchronously before any await, which is what serializes the remaining waiters.
