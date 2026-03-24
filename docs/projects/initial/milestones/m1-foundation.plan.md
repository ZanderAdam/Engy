---
title: Foundation
status: complete
---

# Plan: M1 Foundation

## Overview

Build the foundational monorepo: two pnpm packages (`web/` = Next.js + custom server, `client/` = Node.js daemon) communicating over WebSocket. Includes the full SQLite/Drizzle schema, tRPC API, and an MCP server (HTTP/SSE) embedded in the web process. The UI provides workspace creation and a navigation shell with empty-state tabs. After M1, users can create a workspace, navigate its tabs, and Claude Code CLI can query Engy data via MCP.

Boundary: no spec editor, no project views, no terminal panel, no diff viewer, no vector search.

---

## Monorepo Structure

```
engy/
├── web/                        # Next.js app + custom server
│   ├── server.ts               # Custom HTTP server (Next.js + WS + MCP SSE)
│   └── src/
│       ├── app/                # Next.js App Router pages
│       │   ├── layout.tsx      # Root layout
│       │   ├── page.tsx        # Home (workspace list)
│       │   └── w/[workspace]/  # Workspace shell + tabs
│       ├── server/
│       │   ├── db/             # Drizzle schema + client + migrations
│       │   ├── trpc/           # tRPC routers (workspace, project, task, milestone, group)
│       │   └── mcp/            # MCP server + tools
│       └── components/         # shadcn + custom UI components
├── client/                     # Node.js daemon
│   └── src/
│       ├── ws/                 # WebSocket client (connects to web/)
│       ├── git/                # simple-git wrapper
│       └── watcher/            # chokidar file watcher
├── common/                     # Shared types (no runtime code)
│   └── src/
│       └── ws/                 # WS protocol discriminated union
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                # root: scripts, devDependencies
├── .env.example                # committed — documents all env vars with defaults
├── .eslintrc.json
├── .prettierrc
├── jscpd.json
└── knip.json
```

---

## Functional Requirements

### Monorepo & Tooling

1. pnpm workspaces with `web/`, `client/`, and `common/` packages. Both `web/` and `client/` declare `common/` as a dependency.
2. `pnpm dev` starts both `web/` and `client/` concurrently.
3. `pnpm lint` runs ESLint, jscpd (duplicate detection), and knip (unused exports/deps).
4. `pnpm test` runs Vitest in both packages with coverage; 100% coverage required for server-side business logic.
4b. `pnpm blt` runs build, lint, and test sequentially (pre-commit gate).
   All root scripts delegate to Turbo (`turbo run <task>`) — Turbo handles caching and orchestration behind the scenes.

### Database (web/)

5. SQLite database via Drizzle ORM at `{ENGY_DIR}/engy.db`. Tables: `workspaces`, `projects`, `milestones`, `task_groups`, `tasks`, `agent_sessions`, `fleeting_memories`, `project_memories`, `plan_content`, `comments`.
6. Drizzle migrations run on server startup.
7. `ENGY_DIR` determines the data directory (production: `~/.engy/`, development: `.dev-engy/` via `.env.local`).

### `.engy/` Initialization ([Filesystem Structure Reference](../../specs/initial/context/filesystem.md))

8. On server startup, resolve `ENGY_DIR` to an absolute path (expand `~` via `os.homedir()`, resolve relative paths via `path.resolve` from CWD). Ensure `ENGY_DIR/` exists, then run migrations. Log the resolved path. No workspace data written at this stage.
9. Workspace slugs are derived from the workspace name: lowercase, spaces and non-alphanumeric chars replaced with hyphens, consecutive hyphens collapsed, leading/trailing hyphens stripped. On slug collision, append `-2`, `-3`, etc. Slugs must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
10. On workspace creation, initialize `{ENGY_DIR}/{slug}/` with the following structure. If filesystem initialization fails after the DB row is inserted, delete the DB row as a compensating action. If Default project creation fails, delete the filesystem directory and the DB row.
    - `workspace.yaml` with the schema:
      ```yaml
      name: string          # Display name
      slug: string          # URL/filesystem identifier
      repos:
        - path: string      # Absolute path to repo or subdirectory
      ```
    - `system/overview.md` placeholder
    - `system/features/` and `system/technical/` (empty subdirectories — full shape defined in M7)
    - `specs/`, `docs/`, `memory/` (empty directories)
11. On workspace creation, auto-create a Default project (`isDefault: true`) in SQLite linked to that workspace.

### tRPC API (web/)

12. tRPC endpoint at `/api/trpc/[...trpc]` with routers:
    - **workspace**: `create`, `list`, `get`, `delete`
    - **project**: `create`, `list`, `get`, `updateStatus`, `delete`
    - **milestone**: `create`, `list`, `get`, `update`, `reorder`, `delete`
    - **taskGroup**: `create`, `list`, `get`, `update`, `delete`
    - **task**: `create`, `list`, `get`, `update`, `delete`

### Custom Server & WebSocket (web/)

13. Custom `server.ts` handles HTTP (Next.js), WebSocket upgrades (`ws`), and MCP SSE on a single port (`PORT`, default `3000`). Internally composed via `attachNextJs(server)`, `attachWebSocket(server)`, `attachMCP(server)` — `server.ts` is a composition root only.
14. WebSocket server maintains a reference to the single connected daemon (`WebSocket | null`). Only one daemon is expected; a second connection replaces the first.
15. Server stores file change events from connected daemons in an in-memory ring buffer per workspace (max 100 events, no persistence). Event schema: `{ workspaceSlug: string, path: string, eventType: 'add' | 'change' | 'unlink', timestamp: number }`. No UI subscriber in M1.

### WebSocket Message Protocol

All WebSocket messages use a typed envelope: `{ type: string, payload: unknown }`. Messages are JSON. The following types are defined in M1 (shared TypeScript discriminated union in `common/src/ws/protocol.ts`, exported from `@engy/common` and imported by both `web/` and `client/`):

| Direction | `type` | `payload` | Description |
|-----------|--------|-----------|-------------|
| client → server | `REGISTER` | `{}` | Daemon identifies itself on connect |
| server → client | `WORKSPACES_SYNC` | `{ workspaces: { slug: string, repos: string[] }[] }` | Server pushes full workspace/repo list. Sent immediately after `REGISTER` and after any workspace create/delete. Daemon updates its watch list accordingly. |
| server → client | `VALIDATE_PATHS_REQUEST` | `{ requestId: string, paths: string[] }` | Server asks daemon to check if paths exist on disk |
| client → server | `VALIDATE_PATHS_RESPONSE` | `{ requestId: string, results: { path: string, exists: boolean }[] }` | Daemon reports existence of each path |
| client → server | `FILE_CHANGE` | `{ workspaceSlug: string, path: string, eventType: 'add' \| 'change' \| 'unlink' }` | Daemon reports a file change (includes slug so server knows which workspace) |

### MCP Server (web/, HTTP/SSE)

16. MCP server via `@modelcontextprotocol/sdk` with SSE transport (spec 2024-11-05): `GET /mcp` opens SSE stream, `POST /mcp` sends messages. Transport is instantiated via a factory `createMcpTransport(server, path)` — neither `server.ts` nor tool code references `SSEServerTransport` directly, enabling a one-file migration to Streamable HTTP. Concurrency: one shared `McpServer` instance (singleton) with tools registered once; each inbound SSE connection gets its own `SSEServerTransport` instance connected to that shared server. The DB singleton is safe to share across connections.
17. MCP tools in M1:
    - **Workspace tools**: `createWorkspace`, `getWorkspaceConfig`, `listWorkspaces` — `createWorkspace` follows the same `VALIDATE_PATHS_REQUEST` flow as the UI; fails with a clear error if no daemon is connected. Implemented in Phase 7 (depends on WS dispatch being available).
    - **Project tools**: `createProject`, `getProject`, `updateProjectStatus`, `listProjects`
    - **Task tools**: `createTask`, `updateTask`, `listTasks`, `getTask`
    - **Milestone tools**: `createMilestone`, `listMilestones`
    - **TaskGroup tools**: `createTaskGroup`, `listTaskGroups`
    - **Memory tools**: `createFleetingMemory`, `listMemories` (basic)
    - **File tools**: `readFile`, `listDirectory` — paths are restricted to `allowedRoots` (initialized from resolved `ENGY_DIR` + workspace repo directories). All input paths are resolved to absolute, then verified via `path.relative(root, resolved).startsWith('..')` check. Traversal attempts are rejected with a descriptive error.

### Client Daemon (client/)

**Cardinality:** One daemon process per machine, managing all workspaces. No workspace-scoped configuration needed.

18. On startup, connects to `ENGY_SERVER_URL` via WebSocket and sends `REGISTER`. Server responds with `WORKSPACES_SYNC`; daemon begins watching all listed repo dirs. Handles `VALIDATE_PATHS_REQUEST` and responds with `VALIDATE_PATHS_RESPONSE`. Tags each `FILE_CHANGE` with the appropriate `workspaceSlug`.
19. Reconnects with exponential backoff on disconnect (initial delay 1s, max 30s, jitter ±20%). On reconnect, server re-sends `WORKSPACES_SYNC` so daemon re-initialises its watch list.
20. Provides git operations: `getBranchInfo`, `getStatus` for registered repos.

### UI ([UI Design Reference](../../specs/initial/context/ui-design.md))

21. Global layout: header with breadcrumbs, placeholder slot for terminal panel (empty in M1).
22. Home page (`/`): workspace list (name, slug, created date) and "New Workspace" button.
23. "New Workspace" flow: accepts name and repo directory paths. On submit, the server sends a `VALIDATE_PATHS_REQUEST` (UUID `requestId`) to the connected daemon. If no daemon is connected, returns a tRPC error: `"Client daemon is not running. Start it with: pnpm dev"`. The daemon responds with `VALIDATE_PATHS_RESPONSE`; server awaits with a 5-second timeout. If all paths exist, the server creates the workspace (DB row + `{ENGY_DIR}/{slug}/` + Default project), broadcasts `WORKSPACES_SYNC` to the daemon, and the UI navigates to `/w/[slug]`. If any path does not exist, a field-level error is shown per invalid path.
24. Workspace page (`/w/[workspace]`): tab navigation for Overview, Specs, Tasks, Docs, Memory.
25. All tabs except Overview show styled empty states in M1.
26. Overview tab displays: workspace name, slug, repo directories, settings link (placeholder).

---

## Non-Functional Requirements

- **TypeScript strict mode** in both packages.
- **Testing**: Vitest, BDD-style (`describe`/`it`), Trophy approach (integration-heavy), TDD. 100% coverage for `server/db`, `server/trpc`, `server/mcp`, and `client/src` business logic. No UI component tests in M1.
- **Linting**: ESLint + Prettier, jscpd (min 5-line threshold), knip (no unused exports).
- **Error messages**: Descriptive -- include what failed and how to fix (e.g., "Repo directory /foo/bar does not exist on disk").
- **shadcn theme**: lyra style, zinc base color, JetBrains Mono font, remixicon icons, no border radius. Use shad mcp to get up to date component code

---

## End-to-End Flow

1. `pnpm dev` — starts `web/` server and `client/` daemon concurrently (via Turbo). Daemon connects, sends `REGISTER`, retries via backoff until server is ready.
2. Browser: Home page shows empty workspace list.
3. User submits "New Workspace" form (name + repo paths) → server sends `VALIDATE_PATHS_REQUEST` to daemon → daemon checks paths → server creates workspace (DB row + `{ENGY_DIR}/{slug}/` + Default project) → UI navigates to `/w/[slug]`.
4. Daemon begins watching the workspace's repo dirs and tags `FILE_CHANGE` events with the new workspace slug.
5. Claude Code CLI: add `http://localhost:3000/mcp` as MCP server → can query/mutate workspace data via MCP tools.
6. Workspace shell renders tabs; all except Overview show styled empty states.

---

## Out of Scope

| Feature | Milestone |
|---------|-----------|
| Spec editor / spec file creation | M2 |
| Project planning views, dependency graph, swimlane | M3 |
| Terminal panel / xterm.js | M4 |
| Diff viewer | M5 |
| Worktree management | M6 |
| ChromaDB vector search, memory promotion UI | M7 |
| Workspace settings UI | M8 |
| Async agents / Mastra | M9 |

Also excluded from M1: file watcher UI (daemon notifies server but no browser subscriber), authentication (single-user, localhost), Default project UI (DB record created, visible in M3).

---

## Implementation Sequence

> TDD throughout: write failing tests first, then implement. Each step is independently testable.

### Phase 1: Monorepo Scaffold

1. **Root init** — `package.json`, `pnpm-workspace.yaml`, `.gitignore`, root `tsconfig.json`, `.eslintrc.json`, `.prettierrc`, `jscpd.json` (min-lines: 5), `knip.json`, `.env.example`. Root `package.json` scripts: `dev`, `build`, `lint`, `test`, `blt` — each delegates to `turbo run <task>`. `blt` runs `turbo run build lint test`.
2. **Turbo config** — `turbo.json` with `dev`, `build`, `lint`, `test` pipelines. Both `web#dev` and `client#dev` run concurrently with no `dependsOn` — the daemon handles startup race via exponential backoff. Users run `pnpm <script>`, never `turbo` directly.
3. **`common/` scaffold + WS protocol types** — `package.json` (`name: "@engy/common"`), `tsconfig.json` for `common/`. WS protocol types at `common/src/ws/protocol.ts`: TypeScript discriminated union of all WS message types (`REGISTER`, `VALIDATE_PATHS_REQUEST`, `VALIDATE_PATHS_RESPONSE`, `FILE_CHANGE`). No runtime logic — types only. Both `web/` and `client/` declare `@engy/common` as a workspace dependency and import from it.

### Phase 2: web/ Scaffold

Scaffold Command:
```
pnpm dlx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=lyra&baseColor=zinc&theme=zinc&iconLibrary=remixicon&font=jetbrains-mono&menuAccent=subtle&menuColor=default&radius=none&template=next&rtl=false" --template next
```

4. **Next.js + shadcn init** — Initialize inside `web/`. Scripts use custom server (`tsx server.ts`).
5. **Custom server skeleton** — `server.ts` as composition root: creates `http.Server`, calls `attachNextJs(server)`, `attachWebSocket(server)` (stub), `attachMCP(server)` (stub). Stubs are no-ops until Phases 6–7.
6. **Vitest config** — `vitest.config.ts`, v8 coverage provider, includes `src/server/**`.

### Phase 3: Database

7. **Drizzle schema** — `src/server/db/schema.ts`: all 11 tables with relations, types exported.
8. **Drizzle client** — `src/server/db/client.ts`: singleton `better-sqlite3` + Drizzle instance. Resolves `ENGY_DIR` to absolute path (tilde expansion + `path.resolve`). Sets `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=NORMAL` on open. Logs resolved DB path at startup.
9. **Migrations** — `src/server/db/migrations/`: initial migration, `migrate()` on startup. Migration files excluded from coverage gate (DDL-only, tested implicitly via schema tests).
10. **Schema tests** — BDD tests for constraints, relations, nullable fields.

### Phase 4: tRPC

11. **tRPC root** — Router composition (`root.ts`), context + procedure builder (`trpc.ts`) with shared app state object (WS registry, event buffer) passed as context. Next.js handler at `api/trpc/[...trpc]/route.ts`.
12. **Workspace router** — `create`, `list`, `get`, `delete` with zod validation. Slug derived from name per FR #9. Collision handled with suffix. On `delete`: remove DB row first, then delete `{ENGY_DIR}/{slug}/` recursively; if filesystem delete fails, log a warning but do not fail the operation.
13. **Project router** — `create` (auto-creates Default project), `list`, `get`, `updateStatus`, `delete`.
14. **Milestone + TaskGroup routers** — CRUD with ordering for milestones.
15. **Task router** — CRUD with dependency validation (no cycles).

### Phase 5: .engy/ Initialization

16. **EngyDir service** — `src/server/engy-dir/init.ts`: `initWorkspaceDir(name, slug, repos)` creates directory tree + `workspace.yaml` (per schema in FR #10). Compensating cleanup on failure. Tests use temp dirs.
17. **Wire into workspace.create** — tRPC `create`: insert DB row → call `initWorkspaceDir` (on failure: delete row) → create Default project (on failure: delete dir + row). Sequenced, not atomic.

### Phase 6: MCP Server

18. **MCP setup** — `src/server/mcp/index.ts`: singleton `McpServer` with tools registered once. `createMcpTransport(server, path)` factory mounts `GET /mcp` + `POST /mcp` as paired unit, returns new `SSEServerTransport` per inbound connection attached to the shared server. Tests verify tool registration and multi-connection behaviour.
19. **Workspace + Project tools** — `getWorkspaceConfig`, `listWorkspaces`, `createProject`, `getProject`, `updateProjectStatus`, `listProjects`.
20. **Task + Milestone + TaskGroup tools** — `createTask`, `updateTask`, `listTasks`, `getTask`, `createMilestone`, `listMilestones`, `createTaskGroup`, `listTaskGroups`.
21. **Memory + File tools** — `createFleetingMemory`, `listMemories`, `readFile` (path-restricted), `listDirectory` (path-restricted). `allowedRoots` = `[resolvedENGY_DIR, ...workspaceRepoPaths]`. Tests verify traversal rejection.

### Phase 7: WebSocket Server

22. **WS server** — `attachWebSocket(server)` in `src/server/ws/server.ts`. Holds single daemon reference (`WebSocket | null`). Handles `REGISTER` (sets reference), dispatches `VALIDATE_PATHS_REQUEST` (UUID, 5s timeout), collects `VALIDATE_PATHS_RESPONSE`, stores `FILE_CHANGE` in ring buffer keyed by `workspaceSlug`. Tests: mock WS connection including full validation request/response cycle.

### Phase 8: client/ Scaffold & Implementation

23. **Client scaffold** — `package.json`, `tsconfig.json`, Vitest config, `src/index.ts` entry. Declares `@engy/common` as a workspace dependency; imports WS protocol types from `@engy/common`.
24. **WS client** — `src/ws/client.ts`: connect, send `REGISTER`, handle `VALIDATE_PATHS_REQUEST` (check paths with `fs.access`, respond with `VALIDATE_PATHS_RESPONSE`), reconnect with exponential backoff (1s initial, 30s max, ±20% jitter). Tests: mock WS server.
25. **Git service** — `src/git/index.ts`: `getBranchInfo(dir)`, `getStatus(dir)` via simple-git. Tests: temp git repos.
26. **File watcher** — `src/watcher/index.ts`: chokidar watch, debounced `FILE_CHANGE` via WS. Tests: temp dirs.

### Phase 9: UI

27. **Root layout** — `app/layout.tsx`: header (wordmark + breadcrumbs), main area, terminal panel placeholder (hidden).
28. **Home page** — `app/page.tsx`: workspace list (tRPC query), "New Workspace" button, empty state.
29. **Create Workspace dialog** — shadcn Dialog + form: name, repo paths (add/remove), calls `workspace.create`. Surfaces "daemon not running" error and per-path "does not exist" field errors from server.
30. **Workspace shell** — `app/w/[workspace]/layout.tsx`: fetch workspace, tab nav (Overview, Specs, Tasks, Docs, Memory). 404 if not found.
31. **Overview tab** — `app/w/[workspace]/page.tsx`: name, slug, repo list, settings placeholder link.
32. **Empty state tabs** — `app/w/[workspace]/{specs,tasks,docs,memory}/page.tsx`: styled "Coming soon" states.

### Phase 10: Tooling Polish

33. **Knip** — Configure entry points per package, `pnpm lint` passes clean.
34. **jscpd** — Run across both packages, no violations.
35. **Coverage gate** — 100% server business logic coverage in CI. Migration files excluded via vitest coverage exclude config.
36. **blt gate** — `pnpm blt` runs build → lint → test as a single pre-commit/CI gate.

---

## Environment Variables

Defaults in `.env.example` (committed). Overrides in per-package `.env.local` (gitignored).

| Variable | Package | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | web | `3000` | HTTP server port (Next.js + WS + MCP SSE) |
| `ENGY_DIR` | web | `~/.engy/` | Data directory. Always resolved to absolute path at startup. Dev: `.dev-engy/` |
| `ENGY_SERVER_URL` | client | `http://localhost:3000` | Web server URL. WS URL derived via `s/^http/ws/` |

---

## Decisions

- **ENGY_DIR resolution**: Always resolved to absolute path at startup (tilde + `path.resolve`). `web/.env.local` sets `ENGY_DIR=.dev-engy/` in development; production default `~/.engy/`. Resolved path logged on startup.
- **Repo path validation**: Server sends `VALIDATE_PATHS_REQUEST` over WS to connected daemon. If no daemon is connected, workspace creation fails with a clear error message. Server never does direct filesystem access to user repo paths.
- **Workspace creation atomicity**: Not truly atomic (filesystem + SQLite). Failure handled via compensating actions: DB row deleted if filesystem init fails; both deleted if Default project insert fails.
- **Workspace deletion**: DB row deleted first, then `{ENGY_DIR}/{slug}/` removed recursively. If filesystem delete fails, log a warning but do not fail the operation — the workspace is logically deleted from the DB regardless.
- **Daemon cardinality**: One daemon per machine, managing all workspaces. No workspace configuration needed — daemon registers globally and watches repo dirs across all workspaces.
- **WS startup race**: `turbo dev` starts both packages concurrently. Daemon handles the race via exponential backoff — no `dependsOn` in turbo pipeline.
- **MCP authentication**: Open endpoint for M1 (localhost-only assumption, no token).
- **Coverage gate scope**: 100% required for `server/db` (excluding migration files), `server/trpc`, `server/mcp`, `server/ws`, `server/engy-dir`, and `client/src`.

---

## Tech Stack Summary

| Concern | Choice |
|---------|--------|
| Monorepo | pnpm workspaces |
| Build orchestration | Turbo (behind `pnpm` scripts) |
| Web framework | Next.js (App Router) |
| UI components | shadcn (lyra/zinc, JetBrains Mono, remixicon) |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| API | tRPC v11 |
| WebSocket | ws library on custom Next.js server |
| MCP transport | HTTP/SSE via @modelcontextprotocol/sdk |
| Git ops | simple-git |
| File watching | chokidar |
| Testing | Vitest, BDD-style, Trophy approach, TDD, 100% coverage |
| Duplicate detection | jscpd |
| Dead code | knip |
| Linting | ESLint + Prettier |
