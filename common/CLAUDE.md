# Common Package

Shared TypeScript types only. **Zero runtime code, zero dependencies** beyond `typescript` itself.

Consumed by `web/` and `client/` via the `@engy/common` workspace alias. Re-exports live in `src/index.ts` and resolve directly to `src/ws/protocol.ts` (no build step required for development).

## What lives here

- `src/ws/protocol.ts` — discriminated union of every WebSocket message between server and daemon (~40 message types) plus the typed sub-union for the terminal relay.
- `src/index.ts` — flat re-export surface. **All public types must be re-exported here**; consumers import from `@engy/common`, never from a deep path.

## What does **not** belong here

- Runtime code, helpers, or constants — this package must stay zero-runtime.
- Validation logic (zod, etc.) — types only. Validation belongs in `web/src/server/ws/server.ts` or the daemon.
- Dependencies beyond `typescript` devDep. If you're tempted to add one, the code probably belongs in `web/` or `client/`.

## WebSocket protocol

Single discriminated union on `type`. Aggregate unions exported alongside the leaf types:

- `WsMessage` — every message in either direction
- `ClientToServerMessage` — daemon → server
- `ServerToClientMessage` — server → daemon
- `TerminalRelayCommand` / `TerminalRelayEvent` — typed sub-union for `/ws/terminal-relay` (the relay uses compact short-key wire format; see `client/src/terminal/CLAUDE.md`)

### Categories (editorial overlay, not enforced)

Messages cluster into six domains: **registration / sync**, **file system** (validation, search, change events, dir/file I/O, remote pull/push), **git** (status, diff, log, show, branch-files, worktree list/merge), **container lifecycle** (up/down/status/progress, devcontainer config generation), **agent execution** (start/stop, status/complete events), and **terminal relay**. Grep `type:` in `protocol.ts` for the leaf list.

## Adding a new message type

1. Define the request/response (or event) interfaces in `protocol.ts` with literal `type` discriminants.
2. Add them to the appropriate aggregate union(s): `ClientToServerMessage`, `ServerToClientMessage`, or both as relevant.
3. Re-export from `src/index.ts`. Forgetting this is the most common bug — the type compiles in `common/` but consumers can't see it.
4. Wire both sides at once:
   - Server: add a `case` in `web/src/server/ws/server.ts` `handleMessage`, a pending-map in `AppState` (if request/response), and a `dispatch<Op>` helper.
   - Daemon: add a handler in `client/src/ws/client.ts` that performs the work and replies.
5. Add the new pending-map to the `pendingMaps` tuple in `rejectAllPending()` so daemon disconnect cleans it up.

## Conventions

- Naming: `<DOMAIN>_<VERB>_REQUEST` / `<DOMAIN>_<VERB>_RESPONSE`; fire-and-forget messages end in `_EVENT`.
- Every request carries a `requestId: string`; the matching response echoes it. The server uses this to resolve the pending-map entry.
- Payload shapes are flat (no nested envelopes beyond `{ type, payload }`). Keep them minimal — the WS link is hot.
- No `unknown`, `any`, or open-ended record types in payloads. If a field's shape isn't known, push it into a named sub-interface.

## Build

- `src/index.ts` is the package entry (`"main"` and `"types"` both point there) — TypeScript source, not built output. `pnpm build` runs `tsc` for type-checking and emits `dist/` for production server bundles; dev does **not** need it.
- No tests in this package (`"test": "echo 'No tests yet'"`) — the protocol is exercised end-to-end by `web/` and `client/` integration tests.
