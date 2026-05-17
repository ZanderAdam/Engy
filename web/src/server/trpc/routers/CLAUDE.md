# tRPC Routers

Domain routers for the tRPC v11 API. See `../../../../CLAUDE.md` and `../../../CLAUDE.md` for stack and architecture.

One router per domain (`<domain>.ts` + colocated `<domain>.test.ts`), exported as `<domain>Router` and registered in `../root.ts`.

## Authoring rules

- Procedures use `publicProcedure` from `../trpc` (no auth layer exists).
- Inputs: zod schemas inline on the procedure. Hoist shared schemas to module top (see `containerConfigSchema` in `workspace.ts`).
- DB access: `getDb()` from `../../db/client` per call — never cache the handle.
- Errors: throw `TRPCError` with explicit `code` (`NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `PRECONDITION_FAILED`, `INTERNAL_SERVER_ERROR`). Include a human message; attach machine-readable detail in `cause`.
- Slugs: `generateSlug()` / `uniqueWorkspaceSlug()` / `uniqueProjectSlug()` from `../utils.ts`. Don't re-implement.
- Dependency cycles: `validateDependencies()` / `attachBlockedBy()` from `../../tasks/validation`. The same logic is duplicated in `../../mcp/index.ts` — see MCP Parity below.

## Side effects

- File system / git on user repos: **never** call `fs`/`simple-git` here. Dispatch through the daemon via `../../ws/server` (e.g., `dispatchValidation`, `dispatchDevcontainerGenerate`) and `await` the pending-map response.
- `{ENGY_DIR}` operations (server-owned dirs): use `../../engy-dir/*` and `../../project/service` helpers — they're safe to call directly.
- Multi-step writes are **not transactional across DB + FS**. Use compensating actions: if FS init fails after a DB insert, delete the DB row before throwing. See `workspace.create` for the reference pattern.
- DB-only multi-row writes: wrap in `db.transaction((tx) => ...)`. See `task.create`.

## Broadcasts

- After any state-changing mutation, broadcast so connected browsers and the daemon see it. All wrappers live in `../../ws/broadcast`:
  - Tasks → `broadcastTaskChange(action, taskId, projectId?)`
  - Questions → `broadcastQuestionChange(action, taskId?, sessionId?)`
  - Terminal sessions → `broadcastTerminalSessionsChange(action, sessionId, groupKey?, newLabel?)`
  - Workspaces → `broadcastWorkspacesSync(state)` (local helper in `workspace.ts`, sends to daemon)
- Don't expose `broadcastEvent` directly — add a typed wrapper to `broadcast.ts` first.
- Fire-and-forget side effects (e.g., devcontainer generate) must `.catch()` and log — never block the mutation's response on a daemon roundtrip unless the response depends on it.

## Tests

- Setup: `setupTestDb()` from `../test-helpers` in `beforeEach`; `ctx.cleanup()` in `afterEach`. Fresh SQLite + temp `ENGY_DIR` per test, no mocks for the DB.
- Caller: `appRouter.createCaller({ state: ctx.state })`.
- BDD: `describe('<router> router') > describe('<procedure>') > it('should ...')`.
- Daemon-dependent procedures: either assert the `No daemon connected` error path, or stub the daemon WebSocket on `ctx.state.daemon` and resolve the pending map manually.
- Coverage threshold for `src/server/**` is 90/85/90/90 — new branches need tests, not ignores.

## MCP Parity

The MCP server in `../../mcp/index.ts` exposes the same domain operations to AI agents and **shares no code with this layer by design** (root CLAUDE.md calls this "intentional duplication"). Implications:

- Adding or changing a tRPC procedure with the same domain semantics → update the matching MCP tool in `../../mcp/index.ts`. Procedure name, input shape, and error semantics should stay aligned.
- Pure helpers (`validateDependencies`, `attachBlockedBy`, `generateSlug`, `getWorkspaceDir`, broadcasts) live outside both layers and **are** shared — import, don't copy.
- Cycle detection is currently duplicated between `../../tasks/validation.ts` and `../../mcp/index.ts`. Known debt: changes to cycle rules must be made in both spots until consolidated.
- Don't introduce auth/session concerns here that MCP can't honor (or vice versa) without a plan to reconcile both surfaces.
