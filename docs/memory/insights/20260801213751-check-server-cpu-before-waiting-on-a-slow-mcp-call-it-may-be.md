---
subtype: insight
title: Check server CPU before waiting on a slow MCP call — it may be a stale session
keywords:
  - cycle-web
  - mcp-session-id
  - stale session
  - timeout
  - reindex
  - curl POST /mcp
themes:
  - mcp
  - debugging
  - deployment
tags:
  - mcp
  - dx
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** When `mcp__Engy__*` calls start timing out, check the server's CPU before waiting. Idle means a stale MCP session; pegged means real embedding work. To recover without restarting the whole Claude session, hand-craft a fresh session over HTTP: `curl POST /mcp` initialize, capture the `mcp-session-id` header, then `tools/call` with that id.

**Why:** after `pnpm cycle-web` restarts engy-web, an existing session's MCP connection goes stale and every call times out rather than erroring — including trivial DB reads like `listMemories`. From the caller's side that is indistinguishable from CPU-bound local inference, which is the other common reason an Engy MCP call hangs.

**Evidence:** a reindex that had "timed out" for 10+ minutes completed in 209ms once reissued over a freshly initialized MCP session, with the server sitting at 0.3% CPU throughout.
