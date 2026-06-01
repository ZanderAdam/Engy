# MCP Server

`/mcp` endpoint — StreamableHTTPServerTransport. AI agents (Claude Code CLI) connect here. One McpServer instance per HTTP session, created in `handleNewSession()`.

## MCP↔tRPC Parity

The MCP surface and tRPC surface expose the same domain operations (workspace/task/memory CRUD, search, index). This is **intentional duplication** — the two API surfaces exist side by side and have separate implementations in `index.ts` and the tRPC routers respectively. Both share the same Drizzle DB and AppState singleton. Do not try to call tRPC procedures from MCP handlers; duplicate the logic.

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
| `runQmdSearch` | `search/qmd-search.ts` | Unified BM25 / vector / hybrid dispatch; normalises result shape across all three qmd modes |
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

- `registerWorkspaceTools` — `listWorkspaces`, `getWorkspaceDetails`, `listProjects`, `getProjectDetails`, `startProjectCompletion`, `archiveProject`
- `registerTaskTools` — `createTask`, `updateTask` (with `memories[]` passthrough to fleeting memories), `listTasks`, `getTask`, `deleteTask`
- `registerTaskGroupTools` — `createTaskGroup`, `listTaskGroups`, `getTaskGroup`, `updateTaskGroup`, `deleteTaskGroup`
- `registerMemoryTools` — `createFleetingMemory`, `listMemories`, `createPermanentMemory`, `updatePermanentMemory`, `promoteMemory`
- `registerQuestionTools` — `askQuestion`
- `registerIndexTools` — `reindex`, `indexStatus`, `validateWorkspace`
- `registerSearchTools` — `search` (unified; replaces `listMemories` for discovery use cases), `trace` (requirements traceability: FR ↔ tests ↔ source, via `search/trace.ts`)

## Session Lifecycle

Each HTTP `POST /mcp` without an `mcp-session-id` header creates a new `StreamableHTTPServerTransport` and `McpServer`. The session ID is stored in `activeSessions`. `GET /mcp` (SSE stream) and `DELETE /mcp` look up by `mcp-session-id`. Sessions are cleaned up on transport close.
