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

# After schema changes
cd web && pnpm drizzle-kit generate
```

## Architecture

CRITICAL: The server never touches user repos directly. Any file system or git operation goes through the client daemon via WebSocket. This allows the server to run remotely while user repos stay local.


### WebSocket Protocol

Typed discriminated union in `@engy/common`. Message types: `REGISTER`, `WORKSPACES_SYNC`, `VALIDATE_PATHS_REQUEST/RESPONSE`, `FILE_CHANGE`. Only one daemon expected; second connection replaces first.

## Environment Variables

| Variable | Package | Default | Description |
|---|---|---|---|
| `ENGY_DIR` | web | `~/.engy/` | Data directory (SQLite DB + workspace dirs) |
| `PORT` | web | `3000` | HTTP server port |
| `ENGY_SERVER_URL` | client | `http://localhost:3000` | Server URL for daemon |

Dev overrides are in `.dev.env` (gitignored), which sets `ENGY_DIR=.dev-engy/` for project-local data.

## Testing

Trophy testing pattern with BDD style — maximize vertical-slice integration tests, fill gaps with focused unit tests. No mocks for the database. BDD-style: `describe('feature') > describe('operation') > it('should ...')`. Tests colocated with modules (`foo.ts` → `foo.test.ts`). See package CLAUDE.md files for setup details and coverage thresholds.

## CRITICAL Quality Gates
These are non-negotiable and must be verified before committing:
1. Run `/engy:review` when done with changes
2. Run `pnpm blt` 
3. If UI changes, test using playwright-cli. Check `playwright-cli --help` for available commands.

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

## Commit Guidelines
- All commits must follow the Conventional Commits specification:
  ```
    <type>(<scope>): <subject>
    <BLANK LINE>
    <body>
    <BLANK LINE>
    <footer>
  ```
- type: feat, fix, docs, style, refac, chore
- Subject line should be concise (50 characters max)
- Body should explain the "why" behind the changes, not just the "what"
- DO NOT USE milestone or task IDs in commit messages. These are for project management only, not commit history.
