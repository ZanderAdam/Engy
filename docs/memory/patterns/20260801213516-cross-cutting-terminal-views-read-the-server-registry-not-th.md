---
subtype: pattern
title: 'Cross-cutting terminal views read the server registry, not the browser store'
keywords:
  - terminalSessionMeta.activityState
  - TERMINAL_ACTIVITY_CHANGE
  - terminal-session-store
  - TerminalInstance
  - groupKey
  - Command Center
themes:
  - terminal
  - architecture
tags:
  - terminal
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Any cross-cutting terminal view must be driven from the server registry (`GET /api/terminal/sessions?all=1` plus the `TERMINAL_ACTIVITY_CHANGE`/`TERMINAL_SESSIONS_CHANGE` broadcasts), never from the in-memory browser store.

**Why:** activity state is tracked daemon-side and persisted on the server (`terminalSessionMeta.activityState`, set from the daemon's `{t:'act'}` messages), so the registry can show LIVE activity for terminals no browser is currently rendering. The terminal rail's store (`terminal-session-store.ts`) only holds what a currently-mounted TerminalManager publishes, keyed per `groupKey` — un-mounted projects publish nothing. That is the key design fork.

**Connects to:** the Command Center reuses `<TerminalInstance>` standalone (keyed by sessionId) for the live right pane rather than the whole TerminalManager/Dockview stack — TerminalInstance owns its own WS and buffer replay and needs only a tab plus `onStatusChange`. It dispatches no global `terminal:` window events, so it avoids the tabId-broadcast gotcha.
