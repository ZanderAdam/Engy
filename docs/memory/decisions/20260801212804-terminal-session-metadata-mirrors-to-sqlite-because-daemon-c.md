---
subtype: decision
title: Terminal session metadata mirrors to SQLite because daemon changes kill PTYs
keywords:
  - terminalSessionMeta
  - terminal_sessions
  - cycle-web
  - spawnPty
  - restoredTerminalSessions
  - reconnect
themes:
  - terminal
  - persistence
  - deployment
tags:
  - terminal
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Keep surviving-terminal metadata in a SQLite mirror of `terminalSessionMeta` (`terminal_sessions`, write-through + boot restore). Do not move it to the architecturally cleaner daemon-echoed-meta design unless a daemon-restarting change is already shipping anyway.

**Why:** the deciding factor is deployment mechanics, not code cleanliness. A daemon-side protocol change can only ship by restarting the daemon, and a daemon restart kills every live PTY — destroying exactly the sessions the feature exists to preserve. The SQLite approach is web-only and ships with `pnpm cycle-web` alone.

**Evidence:** the problem it solves is that reconnect-vs-spawn classification depended solely on the in-memory `state.terminalSessionMeta` map, which a web restart wipes. On browser reconnect the server misclassified a live session as new, sent `spawn`, and the daemon's `spawnPty` SIGKILLed the still-alive PTY and replaced it with a fresh shell. Every other piece of the resilience design already worked — the daemon keeps PTYs alive, buffers output on relay disconnect, and on reconnect sends both a `sync` of alive sessionIds and `reconnected` buffers. A fresh server dropped both: its sync handler only handled the server-has-meta/daemon-lost-session direction and never adopted daemon-announced sessions it did not know.

**Connects to:** the `restoredTerminalSessions` validation gate exists precisely because DB rows can be stale relative to daemon reality — daemon-echoed meta would not need it, and would subsume both the DB mirror and the query-param adoption path. The browser connect URL already carries every field needed to rebuild meta (workingDir, scopeType, scopeLabel, groupKey), so connect-time adoption is also feasible; the residual race is the browser reconnecting before the daemon relay does.
