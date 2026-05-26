# Web Package

Next.js 16 (App Router) + custom Node.js HTTP server. Contains both the frontend UI and all backend services (tRPC API, WebSocket server, MCP server) served on a single port.

See root `CLAUDE.md` for monorepo commands (`pnpm dev`, `pnpm blt`).

## Directory Structure

### Server (`src/server/`)

```
server.ts                         # Composition root — single http.Server for all protocols
src/server/
├── db/
│   ├── client.ts                 # Drizzle ORM singleton (better-sqlite3, WAL mode)
│   ├── schema.ts                 # Full schema — workspaces, projects, tasks, memories, comments
│   ├── migrate.ts                # Auto-runs migrations on startup
│   └── migrations/               # Drizzle Kit migrations (0000–0008)
├── trpc/
│   ├── context.ts                # AppState singleton on globalThis (survives HMR)
│   ├── trpc.ts                   # tRPC init with superjson transformer
│   ├── root.ts                   # Router composition (8 routers)
│   ├── utils.ts                  # generateSlug(), uniqueWorkspaceSlug(), uniqueProjectSlug()
│   ├── test-helpers.ts           # setupTestDb() — fresh SQLite + ENGY_DIR per test
│   └── routers/
│       ├── workspace.ts          # Workspace CRUD (compensating deletes)
│       ├── project.ts            # Project CRUD + status transitions
│       ├── milestone.ts          # Milestone management
│       ├── task-group.ts         # Task group CRUD
│       ├── task.ts               # Task CRUD + dependency cycle detection
│       ├── comment.ts            # BlockNote comment threads
│       ├── dir.ts                # File listing/searching (via daemon)
│       └── diff.ts               # Git diff operations (via daemon)
├── ws/
│   ├── server.ts                 # Main /ws — daemon communication + request-response maps
│   ├── terminal-server.ts        # /ws/terminal — xterm ↔ daemon PTY relay
│   └── events-server.ts          # /ws/events — file change broadcasts to browsers
├── mcp/
│   └── index.ts                  # /mcp — StreamableHTTPServerTransport for AI agents
├── search/
│   ├── qmd-store.ts              # Per-workspace qmd store singleton (lazy init, cached)
│   ├── qmd-search.ts             # Unified BM25/vector/hybrid dispatch; normalises result shape
│   ├── subtype-affinity.ts       # Post-hoc score reweighting from query-shape signals
│   ├── memory-queries.ts         # getSupersededMemoryPaths() — exclude superseded from results
│   ├── indexer.ts                # update()/forceFullReindex()/syncPermanentMemoryMirror()
│   ├── auto-linker.ts            # Bidirectional link writing on memory create/promote
│   └── validate.ts               # Integrity checks (broken links, schema, orphaned content)
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
    ├── memory/page.tsx           # Fleeting memories
    ├── docs/page.tsx             # Doc browser
    ├── specs/page.tsx            # Spec listing
    └── projects/[project]/       # Project detail pages
        ├── page.tsx              # Project overview
        ├── tasks/page.tsx        # Project tasks
        ├── docs/page.tsx         # Project docs
        └── diffs/page.tsx        # Git diff viewer

src/components/
├── ui/                           # shadcn primitives (button, card, dialog, etc.)
├── layout/                       # Three-panel resizable layout
├── projects/                     # Task cards, kanban board, eisenhower matrix, dependency graph
├── diff/                         # Diff viewer, file list, repo selector
├── terminal/                     # xterm integration, terminal dock
├── editor/                       # BlockNote document editor
├── workspace/                    # Workspace-specific UI
└── providers.tsx                 # QueryClient + tRPC provider setup
```

## Server Architecture

### Three Protocols on One Server

`server.ts` is the composition root. A single `http.Server` handles:
1. **Next.js** — all regular HTTP requests
2. **WebSocket** (`/ws`) — private channel to the client daemon
3. **MCP** (`/mcp`) — AI agent access (StreamableHTTPServerTransport)

### AppState Singleton

`src/server/trpc/context.ts` stores shared state on `globalThis.__engy_app_state__` to survive Next.js HMR:
- `daemon` — main WebSocket to client
- `pendingValidations`, `pendingFileSearches`, `pendingGit*` — request-response maps for daemon calls
- `terminalSessions`, `terminalDaemon` — terminal I/O relay
- `fileChanges`, `fileChangeListeners` — file event tracking + browser broadcast

### Dual API Surface

- **tRPC v11** (`/api/trpc/[...trpc]`) — browser UI. `superjson` transformer, `httpBatchLink`.
- **MCP** (`/mcp`) — AI agents (Claude Code CLI). Same domain operations as MCP tools.

Both share DB and AppState but have separate implementations (intentional duplication).

### Data Storage Split

- **SQLite** (Drizzle ORM + better-sqlite3) — execution state: workspaces, projects, milestones, tasks, memories. WAL mode. At `{ENGY_DIR}/engy.db`.
- **Filesystem** (`{ENGY_DIR}/{workspace-slug}/`) — knowledge: `workspace.yaml`, `system/`, `specs/`, `docs/`, `memory/`. Git-trackable markdown files.

### Database Schema Hierarchy

```
Workspace → Project(s) → Milestone(s) → TaskGroup(s) → Task(s)
                                                      → AgentSession(s)
                       → Task(s) (directly on project)
         → FleetingMemory(ies)   # DB-only; workspace-scoped; no projectId
         → PermanentMemory(ies)  # DB row + markdown file in {workspaceDir}/memory/{subtype}/
         → Comment(s) (by document_path)
```

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
- TanStack Query v5 + tRPC React Query (staleTime: 30s, retry: 1)
- `cn()` utility in `src/lib/utils.ts` for conditional class names

### Real-Time Updates

`src/contexts/file-change-context.tsx` subscribes to `/ws/events` for file change broadcasts from the daemon (via the server relay).

## Key Patterns

### Slug Generation
`generateSlug(name)` in `trpc/utils.ts` — lowercase, non-alphanumeric → hyphens, collapse consecutive, strip edges. Collisions resolved by appending `-2`, `-3`, etc.

### Workspace Creation (Compensating Actions)
Not atomic — uses compensating deletes: if filesystem init fails after DB insert, DB row is deleted. If default project insert fails, both are rolled back.

### Cycle Detection
Iterative DFS via `detectCycle()` in `tasks/validation.ts` for task dependencies. Duplicated in `mcp/index.ts`.

### WebSocket Request-Response
Server sends requests to daemon (e.g., `VALIDATE_PATHS_REQUEST`) and stores a promise resolver in a pending map. Daemon response resolves the promise. Timeouts: validation 5s, file search 10s, git ops 15s.

## Testing

All server tests use `setupTestDb()` from `src/server/trpc/test-helpers.ts`:
- Creates temp directory, sets `ENGY_DIR`, runs migrations against fresh SQLite
- Returns `{ db, state, tmpDir, cleanup }` — call `cleanup()` in `afterEach`
- tRPC tests: `appRouter.createCaller({ state: ctx.state })`

Coverage thresholds (enforced for `src/server/**`): 90% statements, 85% branches, 90% functions, 90% lines. Excludes migrations, schema.ts, test-helpers.
