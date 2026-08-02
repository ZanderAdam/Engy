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
linkedMemories: []
scenarioIds: []
---
**Rule:** Derive a spawned agent's MCP origin from the CALLER's own spawn command — regex `/(https?:\/\/[^\/\s'"]+)\/mcp\//` over `meta.command` — rather than trusting env or config. Fall back to `http://localhost:$PORT`.

**Why:** the caller demonstrably reached the server at that origin, so it works for both claude (JSON `--mcp-config`) and codex (TOML `-c`) command shapes and for remote servers. There is no reliable way for an MCP tool handler to see the HTTP Host header, so the caller's command is the only trustworthy origin source.
