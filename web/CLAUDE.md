# Web Package

Next.js 16 (App Router) + custom Node.js HTTP server. Frontend UI and all backend services (tRPC API, WebSocket server, MCP server) served on a single port.

See root `CLAUDE.md` for monorepo commands and the nested CLAUDE.md index.

## Orientation

- `server.ts` — composition root. One `http.Server` handles Next.js, four WebSocket upgrade paths, and the MCP transport.
- `src/server/` — backend services. Subdirs each have their own CLAUDE.md with authoring rules:
  - `db/` — Drizzle ORM + better-sqlite3 schema & migrations
  - `trpc/routers/` — tRPC v11 procedures (browser UI)
  - `mcp/` — MCP tools (AI agents) — kept in parity with tRPC
  - `ws/` — daemon control channel, terminal relay, browser broadcast
  - `search/` — BM25/vector search, indexer, auto-linker, integrity validation. `qmd-search.ts` exports `isReadme` — import it in both tRPC and MCP filter modes to exclude README rows from all search surfaces.
  - `engy-dir/`, `project/`, `spec/`, `plan/`, `tasks/` — server-owned `{ENGY_DIR}` operations and pure helpers
- `src/app/` — Next.js routes (`/`, `/open`, `/w/[workspace]/...`). All pages are `"use client"`.
- `src/components/` — feature components + shadcn primitives in `components/ui/`. See `components/CLAUDE.md`.

## Directory Structure

### Server (`src/server/`)

```
server.ts                         # Composition root — single http.Server for all protocols
src/server/
├── db/
│   ├── client.ts                 # Drizzle ORM singleton (better-sqlite3, WAL mode)
│   ├── schema.ts                 # Full schema — workspaces, projects, tasks, memories, comments
│   ├── migrate.ts                # Auto-runs migrations on startup
│   └── migrations/               # Drizzle Kit generated migrations — do not hand-edit
├── trpc/
│   ├── context.ts                # AppState singleton on globalThis (survives HMR)
│   ├── trpc.ts                   # tRPC init with superjson transformer
│   ├── root.ts                   # Router composition — one router per domain; see root.ts for full list
│   ├── utils.ts                  # generateSlug(), uniqueWorkspaceSlug(), uniqueProjectSlug()
│   ├── test-helpers.ts           # setupTestDb() — fresh SQLite + ENGY_DIR per test
│   └── routers/                  # workspace, project, milestone, task-group, task, comment, dir, diff, file, execution, question, worktree, memory, search
├── ws/
│   ├── server.ts                 # Main /ws — daemon communication + request-response maps
│   ├── terminal-server.ts        # /ws/terminal + /ws/terminal-relay — browser terminal connection and daemon PTY relay
│   ├── broadcast.ts              # Shared broadcast helpers (terminal sessions change, etc.)
│   └── events-server.ts          # /ws/events — file change broadcasts to browsers
├── mcp/
│   └── index.ts                  # /mcp — StreamableHTTPServerTransport for AI agents
├── search/
│   ├── qmd-store.ts              # Per-workspace qmd store singleton (lazy init, cached)
│   ├── qmd-search.ts             # Unified BM25/vector/hybrid dispatch; normalises result shape; drops README hits; oversamples at min(ceil(limit×1.5), 500); exports isReadme for filter-mode callers
│   ├── subtype-affinity.ts       # Post-hoc score reweighting from query-shape signals
│   ├── memory-queries.ts         # getSupersededMemoryPaths() — exclude superseded from results
│   ├── candidate-clusters.ts     # clusterReviewCandidates() — ad-hoc cosine clustering of pending fleeting memories (never indexed)
│   ├── frontmatter-filter.ts     # buildFrontmatterWhereCondition() for JSON1 structured filters
│   ├── indexer.ts                # update()/forceFullReindex()/syncPermanentMemoryMirror()
│   ├── auto-linker.ts            # Bidirectional link writing on memory create/promote
│   ├── trace.ts                  # FR↔test↔source traceability scanner
│   ├── repo-adapter.ts           # Repo-path normalisation for qmd collection roots
│   └── validate.ts               # Integrity checks (broken links, schema, orphaned content, stale-memory, missing-sources)
├── project/
│   └── service.ts                # File tree traversal, content reading
├── spec/
│   ├── service.ts                # Spec listing, markdown reading
│   ├── frontmatter.ts            # YAML frontmatter parsing
│   └── watcher.ts                # Debounced spec change detection
├── plan/
│   └── service.ts                # Plan file operations
├── engy-dir/
│   ├── init.ts                   # Workspace/project directory initialization
│   └── git.ts                    # Server-side git operations (simple-git)
├── lib/
│   ├── memory-files.ts           # write/read permanent memories, source snapshots, reference records; server-side git commits
│   ├── promote-proposal.ts       # Build promotion proposals for fleeting memories
│   ├── readme-index.ts           # README index block regeneration (updateReadmeIndex, regenerateReadmeChain)
│   ├── requirements.ts           # Requirements parsing helpers
│   └── workspace-lock.ts        # Per-workspace async mutex for git operations
├── services/
│   └── project-completion.ts    # ProjectCompletionService — distillation + archival
└── tasks/
    └── validation.ts             # Cycle detection (iterative DFS)
```

### Frontend (`src/app/`, `src/components/`)

```
src/app/
├── layout.tsx                    # Root layout (JetBrains Mono, dark mode, Providers)
├── page.tsx                      # Home — workspace list + create
├── open/page.tsx                 # Open directory flow
├── api/trpc/[...trpc]/route.ts   # tRPC fetch adapter
└── w/[workspace]/                # Workspace-scoped pages
    ├── layout.tsx                # Three-panel layout + terminal dock
    ├── page.tsx                  # Workspace overview
    ├── tasks/page.tsx            # Task list (kanban, eisenhower, dependency graph)
    ├── memory/page.tsx           # Memory tab — permanent memory browser + fleeting review candidates
    ├── docs/page.tsx             # Doc browser
    ├── specs/page.tsx            # Spec listing
    └── projects/[project]/       # Project detail pages
        ├── layout.tsx            # Project layout
        ├── page.tsx              # Project overview
        ├── tasks/page.tsx        # Project tasks
        ├── docs/page.tsx         # Project docs
        ├── diffs/page.tsx        # Git diff viewer
        ├── memory/page.tsx       # Project memory
        ├── code/page.tsx         # Code browser
        └── claude-plans/page.tsx # Claude plan files

src/components/
├── ui/                           # shadcn primitives (button, card, dialog, etc.)
├── layout/                       # Three-panel resizable layout
├── projects/                     # Task cards, kanban board, eisenhower matrix, dependency graph
├── diff/                         # Diff viewer, file list, repo selector
├── terminal/                     # ghostty-web terminal integration, terminal dock
├── editor/                       # BlockNote document editor
├── workspace/                    # Workspace-specific UI
└── providers.tsx                 # QueryClient + tRPC provider setup
```

## Server Architecture

### Three Protocols on One Server

`server.ts` is the composition root. A single `http.Server` handles:
1. **Next.js** — all regular HTTP requests
2. **WebSocket** (`/ws`) — private channel to the client daemon (four paths — see `src/server/ws/CLAUDE.md`)
3. **MCP** (`/mcp`) — AI agent access (StreamableHTTPServerTransport)

### AppState Singleton

`src/server/trpc/context.ts` stores shared state on `globalThis.__engy_app_state__` to survive Next.js HMR:
- `daemon` — main WebSocket to client
- `pendingValidations`, `pendingFileSearches`, `pendingGit*` — request-response maps for daemon calls
- `terminalSessions`, `terminalDaemon` — terminal I/O relay
- `fileChanges`, `fileChangeListeners` — file event tracking + browser broadcast

### Dual API Surface

- **tRPC v11** (`/api/trpc/[...trpc]`) — browser UI. `superjson` transformer, `httpBatchLink`.
- **MCP** (`/mcp`) — AI agents (Claude Code CLI). Same domain operations as tRPC, intentionally separate implementations. Pure helpers are shared; see `src/server/mcp/CLAUDE.md` for the parity rules.

Both share DB and AppState but have separate implementations (intentional duplication).

### Data Storage Split

- **SQLite** (Drizzle ORM + better-sqlite3) — execution state: workspaces, projects, task groups, tasks, memories. WAL mode. At `{ENGY_DIR}/engy.db`. (Milestones are **not** a SQLite table — they are markdown plan files on disk, referenced by a `milestoneRef` column on task groups/tasks.)
- **Filesystem** (`{ENGY_DIR}/{workspace-slug}/`) — knowledge: `workspace.yaml`, `system/`, `specs/`, `docs/`, `memory/`. Git-trackable markdown files.

### Database Schema Hierarchy

```
Workspace → Project(s) → Milestone(s)* → TaskGroup(s) → Task(s)
                                                      → AgentSession(s)
                       → Task(s) (directly on project)
         → FleetingMemory(ies)   # DB-only; workspace-scoped; no projectId
         → PermanentMemory(ies)  # DB row + markdown file in {workspaceDir}/memory/{subtype}/
         → Comment(s) (by document_path)
```

*Milestones are markdown plan files on disk (managed by `plan/service.ts` + the `milestone.ts` router), not a SQLite table — task groups and tasks reference them via a `milestoneRef` text column.

- **`fleetingMemories`** — quick-capture notes (content, type, source, tags, sources[]). DB-only; no corresponding filesystem file. Workspace-scoped (no `projectId`). Promoted via `promoteMemory` which creates a `permanentMemories` row + markdown file and sets `promoted=true`, `promotedFromId`, `promotedAt`.
- **`permanentMemories`** — Zettelkasten-style notes persisted as both a DB row and a markdown file in `{workspaceDir}/memory/{subtype}/`. Full metadata: subtype (decision/pattern/fact/convention/insight), title, content, repo (optional provenance), confidence, keywords, themes, tags, linkedMemories, scenarioIds, sources, supersededById. The `filePath` column stores the workspace-relative path to the markdown file.
- **`frontmatter`** — universal frontmatter index for all four collections (system/docs/projects/memory). JSON1-queryable `data` column; powers structured filters and reverse-link graph queries.

Migrations auto-run on startup via `runMigrations()`. After schema changes: `pnpm drizzle-kit generate`.

## Frontend Architecture

### UI Stack

- Next.js 16 App Router, React 19, all pages are `"use client"`
- shadcn components (lyra style, zinc base, no border radius)
- Tailwind CSS v4, JetBrains Mono font, remixicon icons
- Dark mode only (`className="dark"` on `<html>`)
- TanStack Query v5 + tRPC React Query (`staleTime: 30s`, `retry: 1`, no refetch on focus)
- `cn()` utility in `src/lib/utils.ts` for conditional class names

### Real-Time Updates

`src/contexts/events-context.tsx` (e.g., `useOnFileChange`) subscribes to `/ws/events` for file change broadcasts from the daemon (via the server relay). Components never open WebSockets directly.

Detailed conventions in `src/components/CLAUDE.md` and `src/components/ui/CLAUDE.md`.

## Key Patterns

### Slug Generation
`generateSlug(name)` in `trpc/utils.ts` — lowercase, non-alphanumeric → hyphens, collapse consecutive, strip edges. Collisions resolved by appending `-2`, `-3`, etc.

### Compensating Actions
Not atomic — uses compensating deletes: if filesystem init fails after DB insert, DB row is deleted. If default project insert fails, both are rolled back. Reference implementation: `workspace.create`.

### Cycle Detection
Iterative DFS via `detectCycle()` in `tasks/validation.ts` for task dependencies. `mcp/index.ts` imports `validateDependencies`/`attachBlockedBy` from there — shared, not duplicated.

### WebSocket Request-Response
Server sends requests to daemon (e.g., `VALIDATE_PATHS_REQUEST`) and stores a promise resolver in a pending map. Daemon response resolves the promise. Timeouts: validation 5s, file search 10s, git ops 15s.

### Daemon-Mediated User Repo Access
File system or git on user repos goes through the daemon via WebSocket dispatchers in `ws/server.ts`. The server never touches user repos directly.

## Testing

Server tests use `setupTestDb()` from `src/server/trpc/test-helpers.ts` — temp directory + `ENGY_DIR` + migrations against fresh SQLite per test. tRPC tests use `appRouter.createCaller({ state: ctx.state })`. No mocks for the DB.

Coverage thresholds enforced for `src/server/**`: 90% statements, 85% branches, 90% functions, 90% lines. Excludes `migrations/`, `schema.ts`, `test-helpers.ts`.
