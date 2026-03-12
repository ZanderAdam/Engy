# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engy is a single-user, AI-assisted engineering workspace manager for spec-driven development. It provides a permanent home for ongoing concerns (workspaces) and ephemeral scopes for bounded work (projects). Currently at Milestone 1 (Foundation) complete, Milestone 2 (Spec Authoring) in planning.

## Monorepo Structure

pnpm monorepo with Turborepo orchestration. Three packages:

- **`web/`** — Next.js 16 (App Router) + custom Node.js HTTP server. Contains both frontend UI and all backend services (tRPC API, WebSocket server, MCP server) on a single port.
- **`client/`** — Node.js daemon that runs locally on the developer's machine. Connects to `web/` via WebSocket. Handles path validation, file watching, and git operations.
- **`common/`** — Shared TypeScript types only (WebSocket protocol discriminated union). Zero runtime code.

## Commands

```bash
pnpm dev          # Start web + client 
pnpm blt          # Pre-commit gate: build + lint + test + knip + jscpd

# Single test file
cd web && pnpm vitest run src/server/trpc/routers/workspace.test.ts
cd client && pnpm vitest run src/ws/client.test.ts
```

## Architecture

### Three Protocols on One Server

`web/server.ts` is the composition root. A single `http.Server` handles:
1. **Next.js** — all regular HTTP requests
2. **WebSocket** (`/ws`) — private channel to the client daemon
3. **MCP SSE** (`/mcp`) — AI agent access (GET = SSE stream, POST = messages)

### Server Never Touches User Repos Directly

CRITICAL: Any file system or git operation goes through the client daemon via WebSocket. The server sends requests like "validate this path" or "what's the git status?" and the client responds with results. This allows the server to run remotely while user repos stay local.

### AppState Singleton on `globalThis`

`web/src/server/trpc/context.ts` stores shared state (`daemon`, `fileChanges`, `pendingValidations`) on `globalThis.__engy_app_state__` to survive Next.js hot module reloads. Tests reset this via `resetAppState()`.

### Dual API Surface

- **tRPC v11** (`/api/trpc/[...trpc]`) — for the browser UI. Uses `superjson` transformer, `httpBatchLink`.
- **MCP** (`/mcp`) — for AI agents (Claude Code CLI). Same domain operations exposed as MCP tools.

Both share the same DB and AppState but have separate implementations (acknowledged intentional duplication).

### Data Storage Split

- **SQLite** (Drizzle ORM + `better-sqlite3`) — execution state: workspaces, projects, milestones, tasks, memories. WAL mode. Lives at `{ENGY_DIR}/engy.db`.
- **Filesystem** (`{ENGY_DIR}/{workspace-slug}/`) — knowledge: `workspace.yaml`, `system/`, `specs/`, `docs/`, `memory/`. These are git-trackable markdown files.

### Database Schema Hierarchy

```
Workspace → Project(s) → Milestone(s) → TaskGroup(s) → Task(s)
                                                      → AgentSession(s)
                       → Task(s) (directly on project)
         → FleetingMemory(ies)
         → Comment(s) (by document_path)
Project  → ProjectMemory(ies)
```

Migrations run automatically on server startup via `runMigrations()` in `server.ts`. Generate new migrations with Drizzle Kit after schema changes.

## Environment Variables

| Variable | Package | Default | Description |
|---|---|---|---|
| `ENGY_DIR` | web | `~/.engy/` | Data directory (SQLite DB + workspace dirs) |
| `PORT` | web | `3000` | HTTP server port |
| `ENGY_SERVER_URL` | client | `http://localhost:3000` | Server URL for daemon |

Dev overrides are in `.dev.env` (gitignored), which sets `ENGY_DIR=.dev-engy/` for project-local data.

## Testing

### Philosophy: Trophy Testing with BDD Style

Follow the Testing Trophy pattern — maximize vertical-slice integration tests that exercise real behavior through full call stacks, then fill in gaps with focused unit tests for edge cases. No mocks for the database; tests use real SQLite instances.

### Test Setup

All server tests use `setupTestDb()` from `web/src/server/trpc/test-helpers.ts`:
- Creates a temp directory, sets `ENGY_DIR`, runs migrations against a fresh SQLite DB
- Returns `{ db, state, tmpDir, cleanup }` — call `cleanup()` in `afterEach`
- tRPC tests create a caller via `appRouter.createCaller({ state: ctx.state })`

### Test Conventions

- BDD-style: `describe('router/feature') > describe('operation') > it('should ...')`
- Tests go next to the module they test: `workspace.ts` → `workspace.test.ts`
- Integration tests exercise full vertical slices (tRPC caller → DB → filesystem side effects)
- Unit tests fill gaps for pure logic (e.g., slug generation, cycle detection)
- No UI component tests currently

### Coverage Thresholds

Enforced in `vitest.config.ts` for `web/src/server/**`:
- Statements: 90%, Branches: 85%, Functions: 90%, Lines: 90%
- Excluded: migrations, schema.ts, test-helpers

## UI Stack

- Next.js 16 App Router, React 19, all pages are `"use client"`
- shadcn components (lyra style, zinc base, no border radius)
- Tailwind CSS v4, JetBrains Mono font, remixicon icons
- Dark mode only (`className="dark"` on `<html>`)
- TanStack Query v5 + tRPC React Query (staleTime: 30s, retry: 1)
- `cn()` utility in `web/src/lib/utils.ts` for conditional class names

## Key Patterns

### Slug Generation
`generateSlug(name)` — lowercase, non-alphanumeric → hyphens, collapse consecutive, strip edges. Collisions resolved by appending `-2`, `-3`, etc.

### Workspace Creation (Compensating Actions)
Not atomic — uses compensating deletes: if filesystem init fails, DB row is deleted. If default project insert fails, both filesystem and DB row are rolled back.

### Cycle Detection
Iterative DFS via `detectCycle()` for task dependencies. Duplicated in both `routers/task.ts` and `mcp/index.ts`.

### WebSocket Protocol
Typed discriminated union in `@engy/common`. Message types: `REGISTER`, `WORKSPACES_SYNC`, `VALIDATE_PATHS_REQUEST/RESPONSE`, `FILE_CHANGE`. Only one daemon expected; second connection replaces first.

## CRITICAL Quality Gates
These are non-negotiable and must be verified before committing:
1. Run `/engy:review` when done with changes
2. Run `pnpm blt` 
3. If UI changes, test in Chrome to verify no hydration errors or unexpected behavior

### Validation Setup
1. Run `pnpm install` to ensure all dependencies are up to date
2. Check what port `.dev.env` is set to (default 4000)
3. Check if any other process is using that port (`lsof -i :4000` on Mac/Linux)
4. If port is in use, pass `PORT` and `ENGY_SERVER_URL` environment variables to `pnpm blt` with an available port, e.g.:
```bash
PORT=4001 ENGY_SERVER_URL=http://localhost:4001 pnpm blt
```

## Formatting

Prettier: semicolons, single quotes, trailing commas, 100 char width, 2-space indent.
