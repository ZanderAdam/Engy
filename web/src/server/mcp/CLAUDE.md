# MCP Server

`StreamableHTTPServerTransport` mounted at `/mcp`. Exposes the same domain operations as the tRPC API (`../trpc/routers/`) to AI agents (Claude Code CLI, etc.).

See `../trpc/routers/CLAUDE.md` for the parity rule from the tRPC side.

## Structure

- Single file `index.ts` hosting `getMcpServer()` factory and `attachMCP(httpServer)` mount.
- Tools registered in five groups: `registerWorkspaceTools`, `registerTaskTools`, `registerTaskGroupTools`, `registerMemoryTools`, `registerQuestionTools`. Add new tools to the matching group; new groups need wiring in `getMcpServer()`.
- Responses go through `mcpResult(data)` / `mcpError(message)` helpers — all content is JSON-encoded text. Don't return raw objects.

## Parity with tRPC

- Every MCP tool corresponds to a tRPC procedure with matching input shape, error semantics, and side effects. **When you change one, change the other.**
- Shared helpers live outside both layers and **must be imported**, not copied:
  - `validateDependencies`, `attachBlockedBy` from `../tasks/validation`
  - `getWorkspaceDir`, `resolveProjectDir` from `../engy-dir/init`
  - `broadcastTaskChange`, `broadcastQuestionChange` from `../ws/broadcast`
  - `taskStatusSchema` from `@/lib/task-status`
  - `readTaskPlan` from `../plan/service`
- Cycle detection is currently duplicated here — known tech debt. If you change cycle rules, update both spots until consolidation.
- File system / git on user repos still goes through the daemon via `../ws/server` dispatchers. MCP must not call `fs`/`simple-git` on user repos directly, just like tRPC.

## Authoring tools

- Inputs: zod schemas. Mirror the tRPC procedure's input shape — same keys, same defaults — so the two surfaces stay swap-compatible.
- Path resolution: use `resolveWorkspacePaths(ws)` / `resolveSpecPath(ws, specId)` / `attachSpecPaths(rows)` from this file. Don't recompute `{ENGY_DIR}/{slug}/...` ad-hoc.
- Broadcast after every state-changing tool, same events as the tRPC mutation would emit. Browsers and the daemon depend on a single event stream regardless of which API mutated.
- Errors go through `mcpError(message)` with a string a human/LLM can act on — not a stack trace.

## Sessions & transport

- One `McpServer` instance per session, kept alive in the `activeSessions` map keyed by `mcp-session-id`. Don't add a second transport type. Per-session input schemas are hoisted to module scope (the `*Input` consts) so the zod graph is built once and shared — never inline schemas back into `mcp.tool(...)` calls, that reintroduces a per-session closure leak.
- **Authoritative cleanup is the idle reaper**, not `DELETE`/`onclose`. `evictIdleSessions()` runs on a `setInterval` (`SESSION_SWEEP_MS = 5 * 60_000`) started once from `attachMCP` (guarded on `globalThis` against HMR, like the AppState singleton). Any session whose last POST/GET is older than `SESSION_IDLE_TTL_MS = 30 * 60_000` is `transport.close()`d, removed from `activeSessions`, and logged. `DELETE /mcp` and `onclose` still remove sessions eagerly, but cannot be relied on: clients routinely drop the connection without a `DELETE`, and in SDK 1.27 `onclose` is coupled to TCP keepalive (upstream [#1852](https://github.com/modelcontextprotocol/typescript-sdk/issues/1852)) so it fires unpredictably. The reaper is the backstop that guarantees transports don't leak.
- Do not introduce auth that diverges from tRPC (currently both are unauthenticated, single-user).
