# MCP Server

`StreamableHTTPServerTransport` mounted at `/mcp`. AI agents (Claude Code CLI) connect here. One `McpServer` instance per HTTP session, created in `handleNewSession()`.

See `../trpc/routers/CLAUDE.md` for the parity rule from the tRPC side.

## MCP↔tRPC Parity

The MCP surface and tRPC surface expose the same domain operations (workspace/task/memory CRUD, search, index). This is **intentional duplication** — the two API surfaces exist side by side and have separate implementations in `index.ts` and the tRPC routers respectively. Both share the same Drizzle DB and AppState singleton. Do not try to call tRPC procedures from MCP handlers; duplicate the logic.

- Every MCP tool corresponds to a tRPC procedure with matching input shape, error semantics, and side effects. **When you change one, change the other.**
- Shared helpers live outside both layers and **must be imported**, not copied:
  - `validateDependencies`, `attachBlockedBy` from `../tasks/validation`
  - `getWorkspaceDir`, `resolveProjectDir` from `../engy-dir/init`
  - `broadcastTaskChange`, `broadcastQuestionChange` from `../ws/broadcast`
  - `taskStatusSchema` from `@/lib/task-status`
  - `readTaskPlan` from `../plan/service`
- Cycle detection is currently duplicated here — known tech debt. If you change cycle rules, update both spots until consolidation.
- File system / git on user repos still goes through the daemon via `../ws/server` dispatchers. MCP must not call `fs`/`simple-git` on user repos directly, just like tRPC.

## Search Dispatch — `runMcpSearch`

The `search` MCP tool funnels into four internal functions based on what the caller provides:

| Caller provides | Dispatcher called |
|---|---|
| `query` only | `mcpQueryOnly` |
| `filters` only | `mcpFiltersOnly` |
| `query` + `filters` | `mcpQueryWithFilters` |

`runMcpSearch(workspaceId, workspaceSlug, query, collection, filters, limit, mode, intent)` inspects `hasQuery` / `hasFilters` booleans and routes to the appropriate function. All three return `SearchResultGroup[]` (collection-keyed).

### `mcpQueryOnly`
- Runs SQLite `LIKE` on tasks (always, unless collection-scoped to non-tasks).
- Calls `runQmdSearch` (from `search/qmd-search.ts`) for hybrid/lex/vector across the qmd store.
- Applies `applySubtypeAffinity` (from `search/subtype-affinity.ts`) to reweight hits by query shape.
- Filters out superseded memory paths via `getSupersededMemoryPaths` (from `search/memory-queries.ts`).

### `mcpFiltersOnly`
- Queries the `frontmatter` SQLite table using `buildFrontmatterWhereCondition`.
- Array-membership filters (`tags`, `themes`, `scenarioIds`, `sources`, `linkedMemories`) use SQLite JSON1 `EXISTS (SELECT 1 FROM json_each(...) WHERE value = ?)`.
- Scalar filters (`type`, `subtype`, `repo`) use `json_extract(data, '$.field') = ?`.
- Tasks filtered separately by `status` via a direct SQL query.

### `mcpQueryWithFilters`
- Runs qmd search with a wider candidate limit (`limit * 8` when a subtype filter is set, `limit * 2` otherwise) to ensure the filter-matching subset is well covered.
- Anchors on the filter: every frontmatter-matching row is returned regardless of whether qmd ranked it — prevents filter-matching docs from silently disappearing if qmd missed them in its top-N.
- Merges qmd scores onto filter results and sorts (scored rows first, then alphabetical).

## Shared Helpers from `search/`

All search functions in `index.ts` delegate to shared helpers — never reimplement search logic here:

| Helper | File | Purpose |
|---|---|---|
| `runQmdSearch` | `search/qmd-search.ts` | Unified BM25 / vector / hybrid dispatch; normalises result shape across all three qmd modes. Drops README hits in every mode; oversamples at min(ceil(limit × 1.5), 500) so the filter rarely underfills. |
| `isReadme` | `search/qmd-search.ts` | Returns true when a displayPath basename is `readme.md` (case-insensitive). Import and apply to frontmatter-anchored row sets in filters-only and query+filters modes so READMEs never appear in any search surface. |
| `getStore` | `search/qmd-store.ts` | Per-workspace qmd store singleton (lazy init, cached) |
| `applySubtypeAffinity` | `search/subtype-affinity.ts` | Post-hoc score reweighting from query-shape signals (`why`, `where`, UPPER_SNAKE) |
| `getSupersededMemoryPaths` | `search/memory-queries.ts` | Set of `filePath` values for superseded permanent memories — exclude from all result sets |
| `update` / `updateAndEmbed` / `forceFullReindex` | `search/indexer.ts` | qmd update + frontmatter table sync; called by `reindex` and `indexStatus` MCP tools |
| `autoLink` | `search/auto-linker.ts` | Bidirectional link writing on memory create/promote; fire-and-forget |
| `runValidateWorkspace` | `search/validate.ts` | Integrity checks (broken links, schema compliance, orphaned content, commit conformance) |

## Path Convention

qmd returns `displayPath` values that are already workspace-relative and collection-prefixed (e.g., `memory/decisions/202604...-foo.md`). **Never double-prefix.** The `collectionFromVirtualPath` helper extracts the collection from qmd's `file` field (`qmd://<collection>/...`); the `path` returned to callers is the bare `displayPath`.

## Filter-Anchored Mode (query + filters)

When both query and filters are present, the filter is the anchor — every frontmatter-matching row appears in the result, with the qmd score attached where available. This prevents qmd's top-N cutoff from silently dropping filter-matching documents. The qmd side runs with `limit * 2` (or `limit * 8` for subtype filters) to maximise score coverage before the filter join.

## Tool Registration

Tools are registered by domain in separate `register*Tools(mcp)` functions:

- `registerWorkspaceTools` — `listWorkspaces`, `getWorkspaceDetails`, `listProjects`, `getProjectDetails`, `startProjectCompletion`, `archiveProject`, `setWorkspaceEarsBdd` (toggles EARS-BDD mode; updates DB + workspace.yaml)
- `registerTaskTools` — `createTask`, `updateTask` (with `memories[]` passthrough to fleeting memories), `listTasks`, `getTask`, `deleteTask`
- `registerTaskGroupTools` — `createTaskGroup`, `listTaskGroups`, `getTaskGroup`, `updateTaskGroup`, `deleteTaskGroup`
- `registerMemoryTools` — `createFleetingMemory`, `listMemories`, `createPermanentMemory`, `updatePermanentMemory`, `promoteMemory`, `writeSourceSnapshot`
- `registerQuestionTools` — `askQuestion`
- `registerIndexTools` — `reindex`, `indexStatus`, `validateWorkspace`
- `registerSearchTools` — `search` (unified; replaces `listMemories` for discovery use cases), `trace` (requirements traceability: FR ↔ tests ↔ source, via `search/trace.ts`)

## Authoring Tools

- Inputs: zod schemas. Mirror the tRPC procedure's input shape — same keys, same defaults — so the two surfaces stay swap-compatible.
- Responses go through `mcpResult(data)` / `mcpError(message)` helpers — all content is JSON-encoded text. Don't return raw objects.
- Path resolution: use `resolveWorkspacePaths(ws)` / `resolveSpecPath(ws, specId)` / `attachSpecPaths(rows)` from this file. Don't recompute `{ENGY_DIR}/{slug}/...` ad-hoc.
- Broadcast after every state-changing tool, same events as the tRPC mutation would emit. Browsers and the daemon depend on a single event stream regardless of which API mutated.
- Errors go through `mcpError(message)` with a string a human/LLM can act on — not a stack trace.

## Sessions & Transport

- One `McpServer` instance per session, kept alive in the `activeSessions` map keyed by `mcp-session-id`. Don't add a second transport type. Per-session input schemas are hoisted to module scope (the `*Input` consts) so the zod graph is built once and shared — never inline schemas back into `mcp.tool(...)` calls, that reintroduces a per-session closure leak.
- Each HTTP `POST /mcp` without an `mcp-session-id` header creates a new `StreamableHTTPServerTransport` and `McpServer`. The session ID is stored in `activeSessions`. `GET /mcp` (SSE stream) and `DELETE /mcp` look up by `mcp-session-id`.
- **Authoritative cleanup is the idle reaper**, not `DELETE`/`onclose`. `evictIdleSessions()` runs on a `setInterval` (`SESSION_SWEEP_MS = 5 * 60_000`) started once from `attachMCP` (guarded on `globalThis` against HMR, like the AppState singleton). Any session whose last POST/GET is older than `SESSION_IDLE_TTL_MS = 30 * 60_000` is `transport.close()`d, removed from `activeSessions`, and logged. `DELETE /mcp` and `onclose` still remove sessions eagerly, but cannot be relied on: clients routinely drop the connection without a `DELETE`, and in SDK 1.27 `onclose` is coupled to TCP keepalive (upstream [#1852](https://github.com/modelcontextprotocol/typescript-sdk/issues/1852)) so it fires unpredictably. The reaper is the backstop that guarantees transports don't leak.
- Do not introduce auth that diverges from tRPC (currently both are unauthenticated, single-user).
