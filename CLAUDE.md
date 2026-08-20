# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engy is a single-user, AI-assisted engineering workspace manager for spec-driven development. It provides a permanent home for ongoing concerns (workspaces) and ephemeral scopes for bounded work (projects).

## Monorepo Structure

pnpm monorepo with Turborepo orchestration. Three packages:

- **`web/`** — Next.js 16 (App Router) + custom Node.js HTTP server. Contains both frontend UI and all backend services (tRPC API, WebSocket server, MCP server) on a single port.
- **`client/`** — Node.js daemon that runs locally on the developer's machine. Connects to `web/` via WebSocket. Handles path validation, file watching, and git operations.
- **`common/`** — Shared TypeScript types only (WebSocket protocol discriminated union). Zero runtime code.

Subdirectory CLAUDE.mds codify patterns at the point of use (auto-loaded when Claude works in that subtree):
- `web/CLAUDE.md`, `client/CLAUDE.md`, `common/CLAUDE.md` — package overviews
- `web/src/server/db/CLAUDE.md` — Drizzle schema & migration rules
- `web/src/server/trpc/routers/CLAUDE.md` — router authoring, compensating actions, broadcasts
- `web/src/server/mcp/CLAUDE.md` — MCP↔tRPC parity rules
- `web/src/server/ws/CLAUDE.md` — four endpoints, pending-map dispatch, broadcasts
- `web/src/components/CLAUDE.md` + `web/src/components/ui/CLAUDE.md` — component conventions & shadcn discipline
- `client/src/terminal/CLAUDE.md` — session lifecycle, compact wire keys, security guard
- `client/src/container/CLAUDE.md` — devcontainer + coder lifecycle, config generation
- `client/src/runner/CLAUDE.md` — agent process spawning across host/container/coder/remote modes

**If you spot drift between any CLAUDE.md and the actual code — wrong file path, renamed helper, stale claim, missing rule — raise it to the user instead of silently working around it.** These files are the project's authoritative onboarding contract; correcting them is higher leverage than completing one task with a workaround.

## Commands

```bash
pnpm dev          # Dev: web + client with hot reload (tsx watch)
pnpm blt          # Pre-commit gate: build + lint + test + knip + jscpd
pnpm jscpd:report # Full clone inventory at 10-line granularity.
                  #   blt and lint fail only on clones of 30 lines or more.
                  #   Run this command to find smaller duplication.
                  #   It also enforces the 3% total budget in .jscpd.json.

# Production (PM2-managed, see ecosystem.config.js). Requires a prior `pnpm build`.
pnpm start        # Start web + client as two PM2 processes (engy-web, engy-client)
pnpm cycle-web    # Rebuild + restart ONLY engy-web; the daemon keeps running and
                  #   reconnects over WS (preserves live terminal/agent sessions)
pnpm stop         # Stop + remove both PM2 processes

# Single test file
cd web && pnpm vitest run src/server/trpc/routers/workspace.test.ts
cd client && pnpm vitest run src/ws/client.test.ts

# After schema changes
cd web && pnpm drizzle-kit generate
```

## Architecture

CRITICAL: The server never touches user repos directly. Any file system or git operation goes through the client daemon via WebSocket. This allows the server to run remotely while user repos stay local.


### WebSocket Protocol

Typed discriminated union in `@engy/common` (~40 message types spanning registration, file system, git, containers, agent execution, and terminal relay). Only one daemon expected; second connection replaces first. See `common/CLAUDE.md` for the protocol catalog and `web/src/server/ws/CLAUDE.md` for the request/response dispatch pattern.

## Environment Variables

| Variable | Package | Default | Description |
|---|---|---|---|
| `ENGY_DIR` | web | `~/.engy/` | Data directory (SQLite DB + workspace dirs) |
| `PORT` | web | `3000` | HTTP server port |
| `ENGY_SERVER_URL` | client | `http://localhost:3000` | Server URL for daemon |

Dev overrides are in `.dev.env` (gitignored), which sets `ENGY_DIR=.dev-engy/` for project-local data. `pnpm dev` always picks a free port — no need to edit `.dev.env` for worktrees. Read the running URL from the startup log line: `[dev] web + client running on http://localhost:<port>`.

**To run the app, always use `pnpm dev` and read its port from that log line.** Do NOT start `web`/`client` manually with inline `PORT=...`/`ENGY_DIR=...` prefixes, and do NOT spin up a second instance from a worktree that already has one running — both `web/.next/dev/lock` and the daemon singleton lock are shared, so the second instance fails. If a dev server is already running for this worktree, reuse it (find its port via its `[dev]` log line or the connected daemon's `ENGY_SERVER_URL`); Next hot-reloads code edits into it. Never run a dev server against the prod `~/.engy` (a port-3000 instance with no `ENGY_DIR` override is prod — leave it alone).


## Subagents
When spawning implementation subagents, pass `model: 'sonnet'` (Opus reserved for orchestration).

## Testing

Trophy testing pattern with BDD style — maximize vertical-slice integration tests, fill gaps with focused unit tests. No mocks for the database. BDD-style: `describe('feature') > describe('operation') > it('should ...')`. Tests colocated with modules (`foo.ts` → `foo.test.ts`). See package CLAUDE.md files for setup details and coverage thresholds.

## Feature Requirements (EARS FR baseline)

`docs/system/features/<area>.md` holds one doc per feature area. Each carries a `## Requirements` table of EARS functional requirements (`FR-<AREA>-<NNN>`) that is the **single source of truth** for that area's contracted behaviour; each FR id is tagged into its verifying test's title — `it('[FR-AREA-NNN] …')` — so `trace` / `engy:validate` report coverage. Conventions: `.claude/skills/implement/references/ears-bdd.md`. Authoring/maintaining these docs is owned by the feature-writing skills — `/engy:feature-docs` (bootstraps or extends an area's baseline; sole owner of `system/features/*.md`) delegating to the `engy:feature-author` agent — never hand-author a new area doc.

**FRs ↔ tests are the fast index from feature to code.** Each FR id is a greppable literal living in both the requirements table and its verifying test's title, so you can jump between "what a feature guarantees" and "the code that implements it" without reading a whole area. To locate a feature: find its FRs (`trace({ workspaceId, sessionId })` coverage summary, or `search`), then `trace({ workspaceId, fr, sessionId })` for that FR's tagged tests + colocated source — the precise blast radius to start from. The reverse holds too: `trace({ workspaceId, file, sessionId })` lists the FRs a file already carries. Prefer this over blind grep whenever you need to find where a behaviour lives.

**Changing behaviour in an area means updating its FRs + test tags in the same change, not later:**
- **Find / read the area's FRs first** — they state the existing guarantees, already linked to tests/source. Discover them with `trace({ workspaceId, sessionId })` (coverage summary), `search({ filters: { scenarioIds: [...] } })`, or `/engy:knowledge-research`; then `trace({ workspaceId, fr, sessionId })` to reach a specific FR's tests/source instead of blind grep.
- **Contract unchanged** (reword/clarify) → edit the row in place, keep the id.
- **New or changed behaviour** → when implementing via `/engy:implement` (EARS-BDD mode) it allocates/updates the FR (through `engy:feature-author`) and tags the failing test for you; doing it by hand, allocate the next free `FR-<AREA>-<NNN>` (gap; never renumber or reuse) and tag the test that proves it.
- **Retired behaviour** → delete the row and its test tags (git is the audit trail).
- **A whole new area** → author it via `/engy:feature-docs` (sole owner of `system/features/*.md`), not by hand.
- Verify every path/symbol the doc cites; after editing any `system/features/*.md` run `engy:reindex` (collection `system`). A stale FR is drift — fix it like a stale CLAUDE.md.

## CRITICAL Quality Gates
These are non-negotiable and must be verified before committing:
1. Run `/engy:review` when done with changes
2. Run `pnpm blt` 
3. If UI changes, test using `pnpm exec playwright-cli` (a devDependency — the bare name is not on
   PATH). Check `pnpm exec playwright-cli --help` for available commands. It opens the `chrome`
   channel by default; where Chrome is absent, pass `--browser=chromium` after a one-time
   `pnpm exec playwright-cli install-browser chromium`.
4. If you changed behaviour in a feature area, update its `docs/system/features/<area>.md` FRs and the `[FR-AREA-NNN]` test tags to match (see Feature Requirements above).

### Validation Setup
Just run `pnpm blt` — `verifyDepsBeforeRun` in `pnpm-workspace.yaml` installs any missing dependencies first, so no manual `pnpm install` is needed. Tests use in-memory SQLite directly — no server or port needed.

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
