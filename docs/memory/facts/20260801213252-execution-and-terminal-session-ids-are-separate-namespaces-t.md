---
subtype: fact
title: Execution and terminal session ids are separate namespaces that never join
keywords:
  - agent_sessions.sessionId
  - __ENGY_SESSION__
  - parseMcpSessionToken
  - ExecutionStartConfig
  - resolveWorktreeRoots
  - spawnAgentTerminal
themes:
  - mcp
  - execution
  - architecture
tags:
  - mcp
  - architecture
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213001-assert-mcp-zod-constraints-against-the-schema-not-through-ca.md
  - >-
    memory/conventions/20260801213339-file-watching-is-subscription-driven-a-file-change-consumer-.md
scenarioIds: []
---
**Rule:** Never assume a headless execution agent can be attributed through MCP. Attributing MCP tool calls to a headless session requires first wiring a per-session MCP config into the execution dispatch path — the terminal plumbing cannot be reused as-is.

**Why:** Engy has TWO decoupled session-id namespaces. `agent_sessions.sessionId` is the execution/worktree session, carries `worktreePath`, is created only by the execution router and PR auto-fix, and is what `trace`/`validateWorkspace` resolve via `resolveWorktreeRoots(sessionId)`. The `/mcp/<token>` per-connection identity exists ONLY for terminal agents — the token is the terminal session id, swapped into the `__ENGY_SESSION__` placeholder for browser terminals or minted in `spawnAgentTerminal` for agent-spawned workers.

**Evidence:** headless execution agents get NO `--mcp-config` and NO token. `ExecutionStartConfig` has no mcp field, execution flags carry only `--append-system-prompt`/`--add-dir`, and the client daemon has zero "mcp" references. They reach MCP via user-scope registration (`claude mcp add … /mcp`) and arrive anonymous (`parseMcpSessionToken → undefined`). So the agents that most need worktree-scoped trace are exactly the ones with no MCP identity.

**Connects to:** this is why `trace`/`validateWorkspace` take an explicit `sessionId` param rather than inferring it. The fix, if needed, is adding `mcpUrl=/mcp/${sessionId}` to `ExecutionStartConfig` using the execution sessionId as the token.

**Contradicts:** the intuition that execution-run agents reuse their execution sessionId as the `/mcp` token, and the idea that identity could be inferred "nearly free" from the MCP connection.
