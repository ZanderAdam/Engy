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
linkedMemories:
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
  - >-
    memory/insights/20260801212834-resync-xterm-s-viewport-when-a-hidden-dockview-panel-becomes.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/insights/20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md
scenarioIds: []
---
**Rule:** Keep surviving-terminal metadata in a SQLite mirror of `terminalSessionMeta` (`terminal_sessions`, write-through + boot restore). Do not move it to the architecturally cleaner daemon-echoed-meta design unless a daemon-restarting change is already shipping anyway.

**Why:** the deciding factor is deployment mechanics, not code cleanliness. A daemon-side protocol change can only ship by restarting the daemon, and a daemon restart kills every live PTY — destroying exactly the sessions the feature exists to preserve. The SQLite approach is web-only and ships with `pnpm cycle-web` alone.

**Evidence:** the problem it solves is that reconnect-vs-spawn classification depended solely on the in-memory `state.terminalSessionMeta` map, which a web restart wipes. On browser reconnect the server misclassified a live session as new, sent `spawn`, and the daemon's `spawnPty` SIGKILLed the still-alive PTY and replaced it with a fresh shell. Every other piece of the resilience design already worked — the daemon keeps PTYs alive, buffers output on relay disconnect, and on reconnect sends both a `sync` of alive sessionIds and `reconnected` buffers. A fresh server dropped both: its sync handler only handled the server-has-meta/daemon-lost-session direction and never adopted daemon-announced sessions it did not know.

**Connects to:** the `restoredTerminalSessions` validation gate exists precisely because DB rows can be stale relative to daemon reality — daemon-echoed meta would not need it, and would subsume both the DB mirror and the query-param adoption path. The browser connect URL already carries every field needed to rebuild meta (workingDir, scopeType, scopeLabel, groupKey), so connect-time adoption is also feasible; the residual race is the browser reconnecting before the daemon relay does.
