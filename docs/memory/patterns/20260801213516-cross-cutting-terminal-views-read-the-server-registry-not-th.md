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
linkedMemories:
  - >-
    memory/conventions/20260801213329-a-buildcommand-change-must-account-for-all-three-terminalses.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/facts/20260801213525-last-sent-equals-actual-pty-size-is-a-system-wide-invariant.md
  - >-
    memory/conventions/20260801213533-the-relay-sync-no-browser-branch-must-do-full-worker-teardow.md
  - >-
    memory/decisions/20260801213540-terminal-spawn-derives-mcp-origin-from-the-caller-s-own-spaw.md
scenarioIds: []
---
**Rule:** Any cross-cutting terminal view must be driven from the server registry (`GET /api/terminal/sessions?all=1` plus the `TERMINAL_ACTIVITY_CHANGE`/`TERMINAL_SESSIONS_CHANGE` broadcasts), never from the in-memory browser store.

**Why:** activity state is tracked daemon-side and persisted on the server (`terminalSessionMeta.activityState`, set from the daemon's `{t:'act'}` messages), so the registry can show LIVE activity for terminals no browser is currently rendering. The terminal rail's store (`terminal-session-store.ts`) only holds what a currently-mounted TerminalManager publishes, keyed per `groupKey` — un-mounted projects publish nothing. That is the key design fork.

**Connects to:** the Command Center reuses `<TerminalInstance>` standalone (keyed by sessionId) for the live right pane rather than the whole TerminalManager/Dockview stack — TerminalInstance owns its own WS and buffer replay and needs only a tab plus `onStatusChange`. It dispatches no global `terminal:` window events, so it avoids the tabId-broadcast gotcha.
