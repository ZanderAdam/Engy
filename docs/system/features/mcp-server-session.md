---
description: MCP HTTP session lifecycle, transport management, idle reaper, response envelope, and trace tool.
order: 15
---

# MCP Server Session

Engy exposes a Model Context Protocol (MCP) endpoint at `/mcp` using the `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. AI agents (Claude Code CLI and equivalent) connect here to call the full Engy tool surface. The session layer is implemented in `web/src/server/mcp/index.ts` and is mounted onto the Node.js `http.Server` from `web/server.ts` via `attachMCP()`.

## Session lifecycle

Each HTTP `POST /mcp` without an `mcp-session-id` header triggers `handleNewSession()`, which allocates a `StreamableHTTPServerTransport` (with a `randomUUID()` session-id generator) and a fresh `McpServer` from `getMcpServer()`. Once the transport fires `onsessioninitialized`, the session is registered in the module-level `activeSessions: Map<string, StreamableHTTPServerTransport>` and `lastActivity` is stamped via `touchSession()`.

Subsequent `POST /mcp` requests carrying a known `mcp-session-id` header are routed to the already-registered transport — no new `McpServer` is allocated, and `touchSession()` refreshes the idle timestamp.

`GET /mcp` (the SSE stream for server-sent notifications) and `DELETE /mcp` (explicit session teardown) both require the `mcp-session-id` header. A missing header returns HTTP 400; an unknown id returns HTTP 404. `DELETE` removes the session from `activeSessions` and `lastActivity`, calls `transport.close()`, and returns HTTP 200. Unsupported HTTP methods receive HTTP 405.

## Per-session McpServer isolation

`getMcpServer()` creates and returns a new `McpServer` instance on every call. This gives each MCP session its own isolated server with no shared mutable state. To avoid per-session closure leaks, all Zod input schemas are hoisted to module-scope constants (`*Input` consts) and shared across every `McpServer` instance — they are passed into `mcp.tool(...)` calls rather than being reconstructed inline.

## Response envelope

Every tool handler returns a uniform `McpToolResult` via one of two helpers:

- `mcpResult(data)` — `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`
- `mcpError(message)` — same shape with `isError: true` and `{ error: message }` as the JSON body

Callers parse `result.content[0].text` as JSON to obtain the payload. This shape is mandated by the MCP SDK's tool result contract and is the same for every tool in the server.

## Idle session reaper

MCP clients routinely drop the connection without sending a `DELETE`, and in SDK 1.27 `transport.onclose` is coupled to TCP keepalive rather than true session end (upstream issue #1852), making it fire unpredictably. Without a backstop, every agent run would leak a full `McpServer` and Zod graph.

`evictIdleSessions(now)` iterates `activeSessions` and closes any session whose `lastActivity` timestamp is more than `SESSION_IDLE_TTL_MS` (30 minutes) in the past. Evicted sessions have `transport.close()` called, are removed from both `activeSessions` and `lastActivity`, and are logged. A session with no recorded activity is treated as just-seen (safe default).

The sweep runs on `setInterval` every `SESSION_SWEEP_MS` (5 minutes). The timer is started once from `attachMCP()` and guarded on `globalThis.__engy_mcp_session_reaper__` — the same pattern as the `AppState` singleton — so Next.js HMR re-imports do not register a second interval.

## Trace tool

The `trace` MCP tool exposes requirements traceability to agent sessions. It calls `traceWorkspace()` from `web/src/server/search/trace.ts`, which builds a traceability matrix by scanning the workspace's feature docs for FR definitions and the repos for tagged tests, then answers one of three directional queries depending on which optional parameters are supplied.

The tool accepts an optional `sessionId` parameter. When present, `resolveWorktreeRoots(sessionId)` (from `web/src/server/trpc/routers/shared.ts`) replaces `ws.repos` as the set of code roots to scan, scoping the result to the calling agent's worktree so uncommitted changes are visible.

**fr-mode** — called with `workspaceId` and `fr` (e.g. `FR-SEARCH-003`): returns `{ kind: 'fr', fr, found, covered, requirement?, tests, sources, orphanTags }`. `found` is false when no definition exists for that id; `covered` is true when at least one test tag matches; `requirement` (present only when `found` is true) carries `{ id, text, file, line }` from the feature doc; `tests` is the list of matching test tags; `sources` lists colocated source files; `orphanTags` lists test tags that reference the FR but have no corresponding definition.

**file-mode** — called with `workspaceId` and `file` (a source or test path): returns `{ kind: 'file', file, defines, coveredBy }`. `defines` is the list of FR ids declared in that file; `coveredBy` is a list of `{ fr, role }` objects where `role` is either `'source'` or `'test'`, indicating how the file participates in each FR's traceability.

**summary-mode** — called with `workspaceId` and no `fr` or `file`: returns `{ kind: 'summary', totals: { definitions, tags, uncovered, orphanTags }, uncovered, orphanTags, duplicateIds, malformed }`. `totals` gives workspace-wide counts; `uncovered` lists FR ids with no test coverage; `orphanTags` lists test tags referencing undefined FRs; `duplicateIds` and `malformed` surface integrity issues in the requirements table.

## Per-session identity (`/mcp/<token>`)

Agents Engy spawns get a per-session MCP endpoint `/mcp/<terminalSessionId>` (the
token is substituted into the command at spawn — see the Terminal Relay feature).
`attachMCP` matches the `/mcp` path prefix, extracts the token, and — because the
`McpServer` is created per connection — closes it over every tool call on that
session. The path is the only identity channel every MCP client honors: a client
always POSTs to the endpoint URL it was configured with (the MCP `Mcp-Session-Id`
is server-assigned and does not convey client identity). `terminal_whoami` exposes
the resolved identity; plain `/mcp` (hand-configured agents, the daemon) stays
anonymous. This underpins `terminal_spawn`'s different-type rule and dispatch
attribution.

## Cross-terminal dispatch tools

`registerTerminalTools` (`web/src/server/mcp/terminal-tools.ts`) exposes the
cross-terminal dispatch surface: `terminal_list_workers`, `terminal_dispatch`
(async by default, sync-with-timeout optional), `terminal_collect`,
`terminal_reply`, `terminal_status`, and `terminal_spawn`. These tools are
**agent-only by design** — the browser manages the connected-worker set via
the `terminal` tRPC router (connect/disconnect with a description), while
agents are the only callers of dispatch/reply/collect/spawn. The only
authorization gate is the connected-worker set: with nothing connected,
`terminal_list_workers` returns an empty list and `terminal_dispatch` refuses
every session id. Reply authorization is the correlation id itself — a
single-use capability token embedded in the `[engy-dispatch <id>]` marker
delivered with each dispatch. Dispatch mechanics (idle-gating, inbox, paste
behavior) live in the Terminal Relay feature.

### Agent-originated spawn (`terminal_spawn`)

An identified agent can spawn a terminal running a **different** agent CLI —
cross-agent delegation (a Claude orchestrator spawning a Codex reviewer),
never self-replication: same-type spawning is refused because that is what an
agent's built-in subagents are for. The caller's own type is resolved
server-side from its `/mcp/<token>` identity, so no self-reporting is
involved. Guard rails: the `cwd` must be inside a workspace repo (worktrees
under a repo count), at most 3 agent-spawned sessions may be live at once
(`AGENT_SPAWN_LIMIT` — this also bounds spawn chains like claude → codex →
claude), and a terminal daemon must be connected. `spawnAgentTerminal`
(`web/src/server/terminal-dispatch.ts`) performs the server-originated spawn:
unlike browser-initiated spawns, the session id is generated first, so the
spawned CLI command carries its resolved `/mcp/<sessionId>` endpoint (no
placeholder substitution). The new session inherits the caller's UI scope
(group, workspace, project) so it appears in the terminal rail, records
`spawnedBy`, and is auto-connected as a dispatch worker; the MCP origin for
the spawned agent is derived from the caller's own spawn command (fallback:
the server's local port).

## Requirements

Functional requirements in EARS notation. These are the single source of truth for the MCP server session feature's behaviour. Tag the verifying tests with the FR id in their title string, e.g. `it('[FR-MCP-010] ...', ...)`, and run `trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-MCP-010 | WHEN a `POST /mcp` request arrives without an `mcp-session-id` header, the system SHALL create a new `StreamableHTTPServerTransport` with a `randomUUID` session-id generator, connect a fresh `McpServer` instance, register the transport in `activeSessions`, and stamp `lastActivity` via `touchSession`. |
| FR-MCP-020 | WHEN a `POST /mcp` request arrives with an `mcp-session-id` header matching an entry in `activeSessions`, the system SHALL refresh `lastActivity` via `touchSession` and delegate the request to the existing transport without creating a new `McpServer`. |
| FR-MCP-030 | WHEN a `GET /mcp` or `DELETE /mcp` request arrives without an `mcp-session-id` header, the system SHALL respond with HTTP 400 and a JSON body `{ "error": "Missing mcp-session-id header" }`. |
| FR-MCP-040 | WHEN a `GET /mcp` or `DELETE /mcp` request arrives with an `mcp-session-id` that is not present in `activeSessions`, the system SHALL respond with HTTP 404 and a JSON body `{ "error": "Session not found" }`. |
| FR-MCP-050 | WHEN a `DELETE /mcp` request arrives with a known `mcp-session-id`, the system SHALL remove the session from `activeSessions` and `lastActivity`, call `transport.close()`, and respond with HTTP 200. |
| FR-MCP-060 | The system SHALL return a distinct `McpServer` instance from each call to `getMcpServer()`, sharing module-scope Zod input schema objects across instances to avoid per-session closure leaks. |
| FR-MCP-070 | The system SHALL return every MCP tool result as `{ content: [{ type: "text", text: "<JSON>" }] }`, and every tool error as the same shape with `isError: true` and `{ "error": "<message>" }` as the JSON body. |
| FR-MCP-080 | WHILE the server is running, the system SHALL evict any session whose `lastActivity` is more than 30 minutes in the past by calling `transport.close()` and removing it from both `activeSessions` and `lastActivity`, on a sweep interval of 5 minutes, with the sweep timer started at most once per process via a `globalThis` guard. |
| FR-MCP-090 | WHEN the `trace` tool is called with a `workspaceId` and an `fr` id, the system SHALL return `{ kind: "fr", fr: string, found: boolean, covered: boolean, requirement?: { id, text, file, line }, tests: TestTag[], sources: string[], orphanTags: TestTag[] }` mapping that FR to its requirement text, tagged tests, colocated source files, and any test tags that reference the FR but have no definition. |
| FR-MCP-095 | WHEN the `trace` tool is called with a `workspaceId` and no `fr` or `file` argument, the system SHALL return `{ kind: "summary", totals: { definitions, tags, uncovered, orphanTags }, uncovered: string[], orphanTags: TestTag[], duplicateIds: string[], malformed: TraceabilityMatrix["malformed"] }` listing workspace-wide coverage gaps and integrity issues. |
| FR-MCP-100 | WHEN the `trace` tool is called with a `workspaceId` and a `file` path, the system SHALL return `{ kind: "file", file: string, defines: string[], coveredBy: { fr: string, role: "source" \| "test" }[] }` listing the FRs defined in that file and all FRs for which the file acts as a source or test. |
| FR-MCP-110 | WHEN `terminal_dispatch` is called, the system SHALL reject session ids not in the connected-worker set or without live session metadata; in async mode it SHALL return the correlation id and dispatch status immediately, and in sync mode it SHALL wait up to `timeoutSeconds` for the reply and return the pending status with a `terminal_collect` hint on timeout instead of failing. |
| FR-MCP-120 | WHEN `terminal_reply` is called with a correlation id, the system SHALL settle the matching unsettled dispatch exactly once (resolving all waiters); unknown or already-settled correlation ids SHALL produce a tool error. |
| FR-MCP-130 | WHEN `terminal_list_workers` is called, the system SHALL return every connected worker with its description, agent type, scope label, and activity state, and SHALL return an empty list with a hint when no workers are connected. |
| FR-MCP-140 | WHEN `terminal_status` is called with a connected worker's session id, the system SHALL return the worker info plus a recent output tail with terminal escape sequences stripped, capped at 2000 characters. |
| FR-MCP-150 | WHEN an MCP client connects at a per-session endpoint `/mcp/<terminalSessionId>`, the system SHALL bind that terminal session id to the connection; `terminal_whoami` SHALL return `{ identified: true, live, terminalSessionId, agentType, scopeLabel, workingDir }` resolved from `terminalSessionMeta` (`live: false` and `agentType: null` when no live session backs the token). WHEN the client connects at plain `/mcp` or empty-token `/mcp/`, `terminal_whoami` SHALL return `{ identified: false }`; WHEN the path token has invalid percent-encoding, the request SHALL be rejected with HTTP 400. |
| FR-MCP-160 | WHEN `terminal_spawn` is called, the system SHALL refuse: anonymous callers (no path token), callers without a live terminal session, callers whose agent type is unknown, an unknown requested `agentType`, a requested `agentType` equal to the caller's own type (same-type work belongs to the agent's built-in subagents), a `cwd` outside every workspace repo, more than 3 live agent-spawned sessions, and spawning with no terminal daemon connected. |
| FR-MCP-170 | WHEN `terminal_spawn` passes validation, the system SHALL generate a new terminal session id, send a spawn command to the daemon whose agent CLI command carries the resolved per-session MCP endpoint `/mcp/<newSessionId>`, register session metadata recording `spawnedBy` and inheriting the caller's UI scope (groupKey, workspace, project), auto-connect the session as a dispatch worker, broadcast the session creation, and return the new session id. |

## Sources

No prior knowledge found.
