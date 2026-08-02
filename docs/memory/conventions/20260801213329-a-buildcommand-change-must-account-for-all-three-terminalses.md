---
subtype: convention
title: A buildCommand change must account for all three terminalSessionMeta.set sites
keywords:
  - buildCommand
  - agent-types.ts
  - terminalSessionMeta.set
  - spawnAgentTerminal
  - __ENGY_SESSION__
  - handleTerminalConnection
themes:
  - terminal
  - spawn
tags:
  - terminal
  - architecture
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/insights/20260801213319-initial-command-injection-races-interactive-shell-startup.md
scenarioIds: []
---
**Rule:** Any change to what `claude`/`codex` `buildCommand` emits (`web/src/lib/agent-types.ts`) must account for ALL three `terminalSessionMeta.set` production sites: browser spawn and restart-adoption (both in `terminal-server.ts`) and the server-originated `spawnAgentTerminal` (`terminal-dispatch.ts`, MCP `terminal_spawn`).

**Why:** `spawnAgentTerminal` builds its command with an already-resolved MCP URL and never runs the `__ENGY_SESSION__` placeholder substitution that `handleTerminalConnection` performs. A `buildCommand` change that emits the placeholder unconditionally — say, adding `--session-id __ENGY_SESSION__` — therefore ships the raw placeholder to the CLI on that path and breaks agent-spawned terminals.

**Evidence:** the substitution guarantee is implemented only on the browser-connection path, not as a shared pre-spawn step; the server-originated path sidesteps it by resolving values eagerly.
