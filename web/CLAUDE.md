# Web Package

Next.js 16 (App Router) + custom Node.js HTTP server. Frontend UI and all backend services (tRPC API, WebSocket server, MCP server) served on a single port.

See root `CLAUDE.md` for monorepo commands and the nested CLAUDE.md index.

## Orientation

- `server.ts` — composition root. One `http.Server` handles Next.js, three WebSocket upgrade paths, and the MCP transport.
- `src/server/` — backend services. Subdirs each have their own CLAUDE.md with authoring rules:
  - `db/` — Drizzle ORM + better-sqlite3 schema & migrations
  - `trpc/routers/` — tRPC v11 procedures (browser UI)
  - `mcp/` — MCP tools (AI agents) — kept in parity with tRPC
  - `ws/` — daemon control channel, terminal relay, browser broadcast
  - `engy-dir/`, `project/`, `spec/`, `plan/`, `tasks/` — server-owned `{ENGY_DIR}` operations and pure helpers
- `src/app/` — Next.js routes (`/`, `/open`, `/w/[workspace]/...`). All pages are `"use client"`.
- `src/components/` — feature components + shadcn primitives in `components/ui/`. See `components/CLAUDE.md`.

## Server architecture

- **Three protocols on one server**: Next.js HTTP, WebSocket (four paths — see `src/server/ws/CLAUDE.md`), MCP (`/mcp`, `StreamableHTTPServerTransport`).
- **AppState singleton** in `src/server/trpc/context.ts` stored on `globalThis.__engy_app_state__` to survive Next.js HMR. Holds the active daemon socket, pending-map per RPC family, terminal session mirrors, and broadcast listener lists.
- **Dual API surface**: tRPC (`/api/trpc/[...trpc]`) for the browser and MCP (`/mcp`) for AI agents. Same domain operations, intentionally separate implementations. Pure helpers are shared; see `src/server/mcp/CLAUDE.md` for the parity rules.
- **Storage split**:
  - SQLite at `{ENGY_DIR}/engy.db` (Drizzle + better-sqlite3, WAL) — execution state.
  - Filesystem at `{ENGY_DIR}/{workspace-slug}/` — `workspace.yaml`, `system/`, `specs/`, `docs/`, `memory/` (git-trackable markdown knowledge).

## Frontend stack

- Next.js 16 App Router, React 19. shadcn primitives (lyra variant, zinc base, no border radius). Tailwind v4, JetBrains Mono, dark mode only.
- TanStack Query v5 + tRPC React Query (`staleTime: 30s`, `retry: 1`, no refetch on focus).
- Real-time updates: subscribe via contexts in `src/contexts/` (e.g., `useFileChangeContext`) — components never open WebSockets directly.
- Detailed conventions in `src/components/CLAUDE.md` and `src/components/ui/CLAUDE.md`.

## Cross-cutting patterns

- **Compensating actions** (not transactions across DB + FS): if filesystem init fails after a DB insert, delete the DB row before throwing. Reference implementation: `workspace.create`.
- **Cycle detection** for task dependencies: iterative DFS in `tasks/validation.ts`. Same logic also duplicated in `mcp/index.ts` — known debt.
- **Daemon-mediated user repo access**: file system or git on user repos goes through the daemon via WebSocket dispatchers in `ws/server.ts`. The server never touches user repos directly.

## Testing

Server tests use `setupTestDb()` from `src/server/trpc/test-helpers.ts` — temp directory + `ENGY_DIR` + migrations against fresh SQLite per test. tRPC tests use `appRouter.createCaller({ state: ctx.state })`. No mocks for the DB.

Coverage thresholds enforced for `src/server/**`: 90% statements, 85% branches, 90% functions, 90% lines. Excludes `migrations/`, `schema.ts`, `test-helpers.ts`.
