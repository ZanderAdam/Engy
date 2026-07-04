---
description: Daemon registration, request/response dispatch, FILE_CHANGE buffering, and browser broadcast over the /ws control channel.
order: 14
---

# WebSocket Daemon Protocol

The `/ws` control channel is the exclusive path between the server (`web/`) and the local client daemon (`client/`). The server never touches user repos or the local filesystem directly — every such operation is mediated by a typed message sent over this channel and resolved through a promise returned to the calling tRPC procedure or MCP tool.

## Architecture

`web/src/server/ws/server.ts` owns the server side: it creates a `WebSocketServer` (no-server mode, upgrade-routed in `web/server.ts`), handles all incoming messages in `handleMessage`, and exposes named dispatcher functions (`dispatchGitStatus`, `dispatchFileSearch`, `dispatchContainerUp`, etc.) that the rest of the server imports. All shared server state — the daemon socket reference, all 30 pending maps, the file-change ring buffers, and the browser-listener set — lives in `AppState` from `web/src/server/trpc/context.ts` on `globalThis.__engy_app_state__`.

`client/src/ws/client.ts` owns the client side: `WsClient` manages the `/ws` socket lifecycle (connect, reconnect, ping/keepalive) and dispatches incoming server requests to the appropriate subsystem handler (`handleGitStatusRequest`, `handleContainerUpRequest`, etc.).

## Registration

When the daemon connects it immediately sends `REGISTER` carrying `os.homedir()` as `payload.homeDir`. The server's `handleRegister` stores the new socket in `state.daemon` and the home directory in `state.daemonHomeDir`, then queries all workspace rows and sends back a `WORKSPACES_SYNC` message containing each workspace's `slug`, `repos`, and `docsDir`. If a second daemon registers while one is already registered the old socket is replaced in `state.daemon` first, then terminated via `ws.terminate()` (not `ws.close()`) so no close-frame reaches it. The client-side closure guard `this.ws !== ws` in the `close` handler silently absorbs the resulting close event on the superseded socket.

On disconnect the `close` handler detects `state.daemon === ws`, sets both `state.daemon` and `state.daemonHomeDir` to `null`, and calls `rejectAllPending` which drains all 25 pending maps and rejects every in-flight promise with `Error('Daemon disconnected')`.

## Request/Response Dispatch

The generic `dispatchDaemonOp` function is the single implementation point for all server→daemon RPCs. It:

1. Rejects immediately with `Error('No daemon connected')` if `state.daemon` is `null` or `readyState !== OPEN`.
2. Allocates a `randomUUID()` `requestId` and guards against duplicate ids.
3. Inserts `{ resolve, reject }` into the appropriate typed pending map (e.g. `state.pendingGitStatus`).
4. Starts a `setTimeout` for the op's timeout; on expiry it deletes the pending entry and rejects with `Error('Daemon operation timed out after Xms')`.
5. Sends the typed JSON message to the daemon.

When the matching `*_RESPONSE` arrives, `resolvePendingResponse` finds the entry by `requestId`, deletes it, clears the timer, and either resolves with the extracted payload or rejects if `payload.error` is set.

Timeout constants are defined per operation class in `server.ts`:

| Class | Constant | Value |
|---|---|---|
| `VALIDATION_TIMEOUT_MS` | Path validation | 5 s |
| `FILE_SEARCH_TIMEOUT_MS` | File search | 10 s |
| `GIT_TIMEOUT_MS` | Git ops | 15 s |
| `DEVCONTAINER_GENERATE_TIMEOUT_MS` | Devcontainer config generate | 15 s |
| `EXECUTION_TIMEOUT_MS` | Execution start/stop | 300 s |
| `CONTAINER_TIMEOUT_MS` | Container up/down/status | 300 s |
| `REMOTE_FILE_TIMEOUT_MS` | Remote file pull/push | 30 s |
| `WORKTREE_MERGE_TIMEOUT_MS` | Worktree merge/add/remove | 60 s |
| `GH_LOGS_TIMEOUT_MS` | GitHub failed-log / review-comment fetch | 60 s |

Named dispatcher exports (`dispatchGitStatus`, `dispatchFileSearch`, `dispatchContainerUp`, `dispatchExecutionStart`, `dispatchWorktreeMerge`, `dispatchFsDelete`, `dispatchFsRename`, `dispatchGhPrList`, `dispatchGhAuthStatus`, `dispatchGhPrFailedLogs`, `dispatchGhPrReviewComments`, etc.) delegate to `dispatchDaemonOp` — routers and MCP tools import these and never construct raw WebSocket messages themselves.

## FILE_CHANGE Ring Buffer

When the daemon detects a filesystem change it sends a `FILE_CHANGE` message. `handleFileChange` in `server.ts` appends a `FileChangeEvent` (`{ workspaceSlug, path, eventType, timestamp }`) to the per-workspace array in `state.fileChanges`. If the array exceeds `MAX_EVENTS_PER_WORKSPACE` (100) the oldest entries are spliced out, keeping exactly 100. Each workspace has its own independent array. After buffering, `broadcastFileChange` is called (see below) and, if the path contains `/projects/` or `\projects\`, the spec-watcher `handleSpecFileChange` is triggered.

## Browser Broadcast (`/ws/events`)

`web/src/server/ws/events-server.ts` creates a second `WebSocketServer` on `/ws/events`. On connection it adds the browser socket to `state.fileChangeListeners`; on close or error it removes it.

`web/src/server/ws/broadcast.ts` contains the broadcast infrastructure:

- `broadcastEvent(event)` iterates `state.fileChangeListeners` and calls `ws.send(msg)` for every socket whose `readyState === WebSocket.OPEN`. Closed or connecting sockets are silently skipped.
- Eight typed wrapper functions — `broadcastFileChange`, `broadcastTaskChange`, `broadcastQuestionChange`, `broadcastTerminalSessionsChange`, `broadcastMemoryChange`, `broadcastTerminalActivityChange`, `broadcastPrChange`, `broadcastPrAttention` — each construct their typed payload and call `broadcastEvent`. No caller uses `broadcastEvent` directly.

Broadcasts are fire-and-forget and must not be awaited.

## Client-Side Reliability (`WsClient`)

**Outbox.** `WsClient.send()` transmits immediately when `this.ws.readyState === WebSocket.OPEN`. If the socket is not open and the message type is one of `EXECUTION_STATUS_EVENT`, `EXECUTION_COMPLETE_EVENT`, or `CREATE_MEMORIES_EVENT`, the message is queued in `this.outbox` (capacity `OUTBOX_MAX = 100`). On overflow the outbox prefers evicting the oldest `EXECUTION_STATUS_EVENT` entry rather than a complete or memories event; if no status event is present the oldest entry of any type is dropped. On reconnect the `open` handler calls `flushOutbox()` which drains the queue in order before any new messages are sent.

**Reconnect with exponential backoff.** `computeBackoff(attempt)` computes `min(1000 × 2^attempt, 30_000)` with ±20 % jitter (`JITTER_FACTOR = 0.2`). `scheduleReconnect()` calls it, increments `this.attempt`, and schedules `createConnection()`. `close()` sets `intentionallyClosed = true` so no reconnect is scheduled. On reconnect the `open` handler resets `this.attempt` to 0, resends `REGISTER`, and calls `flushOutbox()`.

**Ping/pong keepalive.** `startPing(which)` schedules an `setInterval` every `PING_INTERVAL_MS = 30_000 ms`. Each interval checks whether `Date.now() - this.lastPong[which]` exceeds `PING_INTERVAL_MS × PONG_DEADLINE_INTERVALS` (= 60 s). If the deadline is exceeded the socket is `terminate()`d to break half-open connections; otherwise `ws.ping()` is sent. `lastPong` is seeded to `Date.now()` on `startPing` so the first interval never false-positives.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-WS-010 | WHEN the daemon sends `REGISTER`, the system SHALL store the socket as `state.daemon`, store `payload.homeDir` (or `null` if absent) as `state.daemonHomeDir`, and respond with a `WORKSPACES_SYNC` message containing every workspace's `slug`, `repos`, and `docsDir`. |
| FR-WS-020 | WHEN a second daemon sends `REGISTER` while one is already registered, the system SHALL atomically replace `state.daemon` with the new socket before terminating the old socket via `ws.terminate()`, so the old socket receives no close-frame. |
| FR-WS-030 | WHEN the registered daemon's socket closes, the system SHALL set `state.daemon` and `state.daemonHomeDir` to `null` and reject every in-flight pending-map promise with `Error('Daemon disconnected')`. |
| FR-WS-040 | WHEN a daemon operation is dispatched, the system SHALL assign a `randomUUID` `requestId`, record `{ resolve, reject }` in the typed pending map, and start a per-class timeout timer before sending the request to the daemon. |
| FR-WS-050 | WHEN a `*_RESPONSE` message arrives with a known `requestId`, the system SHALL remove the pending-map entry, cancel the timeout, and resolve the promise; IF `payload.error` is set, THEN the system SHALL reject the promise instead. |
| FR-WS-060 | IF `state.daemon` is `null` or its `readyState` is not `OPEN`, THEN the system SHALL immediately reject the dispatch promise with `Error('No daemon connected')` without inserting into the pending map. |
| FR-WS-070 | IF no `*_RESPONSE` arrives before the operation's timeout elapses, THEN the system SHALL remove the pending-map entry and reject the promise with a timed-out error. The error message varies by dispatcher: `dispatchDaemonOp`-based operations use `'Daemon operation timed out after Xms'`; `dispatchValidation` uses `'Validation timed out after Xms'`; `dispatchFileSearch` uses `'File search timed out after Xms'`. |
| FR-WS-080 | IF a `dispatchDaemonOp` call uses a `requestId` that already exists in the pending map, THEN the system SHALL reject the dispatch promise with `Error('Duplicate requestId: …')` without sending to the daemon. |
| FR-WS-090 | WHEN a `FILE_CHANGE` message arrives, the system SHALL append the event to the per-workspace ring buffer in `state.fileChanges`, splicing the oldest entries when the buffer exceeds `MAX_EVENTS_PER_WORKSPACE` (100) so exactly 100 entries are retained. |
| FR-WS-100 | WHEN a browser connects to `/ws/events`, the system SHALL add its socket to `state.fileChangeListeners` and remove it on close or error. |
| FR-WS-110 | WHEN `broadcastEvent` is called, the system SHALL send the serialised event to every socket in `state.fileChangeListeners` whose `readyState === WebSocket.OPEN`, silently skipping all others. |
| FR-WS-120 | WHEN `WsClient.send()` is called with a message of type `EXECUTION_STATUS_EVENT`, `EXECUTION_COMPLETE_EVENT`, or `CREATE_MEMORIES_EVENT` and the socket is not `OPEN`, the system SHALL enqueue the message in the outbox, evict the oldest `EXECUTION_STATUS_EVENT` entry on overflow before falling back to evicting the oldest entry of any type, and flush the outbox in order upon the next successful reconnect. |
| FR-WS-130 | WHEN the `/ws` socket closes unintentionally, the system SHALL schedule reconnection after a delay of `min(1000 × 2^attempt, 30_000) ms` with ±20 % jitter, resend `REGISTER` on reconnect, and suppress reconnection IF `intentionallyClosed` is `true`. |
| FR-WS-140 | WHILE the `/ws` socket is `OPEN`, the system SHALL send a ping every `30 s` and terminate the socket via `ws.terminate()` IF no pong has been received for 60 s (two ping intervals' worth of time) since the last pong. |
| FR-WS-150 | WHEN the daemon receives `GH_PR_LIST_REQUEST` with `repoDir` and optional `coderWorkspace`, the system SHALL execute `gh pr list --json` in that directory (via coder ssh when `coderWorkspace` is set) and respond with `GH_PR_LIST_RESPONSE` containing `{ requestId, prs: GhPr[] }` on success or `{ requestId, error }` on failure. |
| FR-WS-170 | WHEN the daemon receives `GH_PR_FAILED_LOGS_REQUEST` with `repoDir`, `prNumber`, and optional `coderWorkspace`, the system SHALL fetch failing check logs via `gh pr checks` and `gh run view --log-failed` and respond with `GH_PR_FAILED_LOGS_RESPONSE` containing `{ requestId, logs: Array<{ checkName: string; excerpt: string }> }` on success or `{ requestId, error }` on failure. |
| FR-WS-180 | WHEN the daemon receives `GH_PR_REVIEW_COMMENTS_REQUEST` with `repoDir`, `prNumber`, and optional `coderWorkspace`, the system SHALL fetch review comments via `gh api` with `--paginate --slurp` and respond with `GH_PR_REVIEW_COMMENTS_RESPONSE` containing `{ requestId, comments: GhReviewComment[] }` on success or `{ requestId, error }` on failure. |

## Sources

No prior knowledge found.
