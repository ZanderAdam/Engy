---
subtype: decision
title: terminal_spawn derives MCP origin from the caller's own spawn command
keywords:
  - terminal_spawn
  - meta.command
  - MCP origin
  - '--mcp-config'
  - Host header
  - 'localhost:$PORT'
themes:
  - mcp
  - terminal
  - spawn
tags:
  - mcp
  - architecture
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213329-a-buildcommand-change-must-account-for-all-three-terminalses.md
  - >-
    memory/facts/20260801213252-execution-and-terminal-session-ids-are-separate-namespaces-t.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/conventions/20260801213533-the-relay-sync-no-browser-branch-must-do-full-worker-teardow.md
  - >-
    memory/patterns/20260801213516-cross-cutting-terminal-views-read-the-server-registry-not-th.md
  - >-
    memory/insights/20260801213751-check-server-cpu-before-waiting-on-a-slow-mcp-call-it-may-be.md
scenarioIds: []
---
**Rule:** Derive a spawned agent's MCP origin from the CALLER's own spawn command — regex `/(https?:\/\/[^\/\s'"]+)\/mcp\//` over `meta.command` — rather than trusting env or config. Fall back to `http://localhost:$PORT`.

**Why:** the caller demonstrably reached the server at that origin, so it works for both claude (JSON `--mcp-config`) and codex (TOML `-c`) command shapes and for remote servers. There is no reliable way for an MCP tool handler to see the HTTP Host header, so the caller's command is the only trustworthy origin source.
