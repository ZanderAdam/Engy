# WebSocket Server

Four independent endpoints on the single HTTP server (upgrade routing in `web/server.ts`):

| Path | File | Direction | Purpose |
|---|---|---|---|
| `/ws` | `server.ts` | daemon ↔ server | Control channel — registration, validation, git, file I/O, container & execution lifecycle |
| `/ws/terminal` | `terminal-server.ts` | browser ↔ server | terminal UI sockets (one per terminal pane) |
| `/ws/terminal-relay` | `terminal-server.ts` | daemon ↔ server | Daemon-side terminal I/O; server relays bytes between this and `/ws/terminal` |
| `/ws/events` | `events-server.ts` | server → browsers | Broadcast (file/task/question/terminal-sessions change) |

`/ws/terminal` and `/ws/terminal-relay` are distinct `WebSocketServer` instances in `terminal-server.ts`. Don't multiplex — each endpoint has its own message vocabulary and lifecycle.

## Message protocol

All control messages between server and daemon are typed in `@engy/common` as a **discriminated union** on `type`. Add a new message type there first; both sides must compile against the same union. Terminal-relay wire format (compact `{ t, sessionId, ... }` keys) is documented in `../../../../client/src/terminal/CLAUDE.md`.

## Request/response pattern

- Server → daemon RPCs use the **pending-map pattern**: store a `{ resolve, reject, timeoutId }` in `state.pending<Op>` keyed by `requestId`, send the request, resolve when the matching response arrives in `handleMessage`.
- Use `dispatchDaemonOp(...)` for new ops — it handles map insertion, timeout, no-daemon rejection, and cleanup uniformly. Don't roll a parallel implementation.
- Public dispatcher exports have no single signature convention — some take `state` first (e.g., `dispatchContainerUp`, `dispatchExecutionStart`), others take it last (e.g., `dispatchGitStatus`, `dispatchFileSearch`). Match the most similar existing dispatcher when adding one. Routers import these; they never construct WebSocket payloads themselves.
- **Always** set a timeout. Defaults: validation 5s, file search 10s, git 15s, container 300s. Pick the closest existing constant rather than inventing new ones.
- Daemon disconnect rejects **all** pending maps with `Error('Daemon disconnected')` — make sure new pending maps are added to the `pendingMaps` tuple in `rejectAllPending()`.

## Connections

- One daemon at a time. `REGISTER` from a second connection replaces the first; `state.daemon = null` on close. Routers must check `state.daemon` (or rely on `dispatchDaemonOp`'s built-in check) before sending.
- Browser event listeners (`state.fileChangeListeners`) are many; iterate-and-send with `readyState === WebSocket.OPEN` filter. `broadcast.ts` already does this — use it.

## Broadcasts (server → browsers)

- Add a new event type to `broadcast.ts`'s `ServerEvent` union + a typed wrapper (`broadcast<X>`). Don't expose raw `broadcastEvent`.
- Broadcasts are **fire-and-forget**, best-effort. Never `await` them; they must not block a tRPC/MCP response.
- Event ordering across clients is not guaranteed — clients reconcile via re-fetch on the relevant queryKey.

## Tests

- WS tests in this dir bind **real** `WebSocketServer` instances on an ephemeral-port HTTP server, with local `waitForMessage`/`waitForClose` Promise helpers (not mocks). Note: sandboxed runs hang on `listen` EPERM — run vitest/blt unsandboxed.
- When adding a dispatcher, test both the happy path (response resolves) and the timeout/no-daemon path (rejects with a useful error).
