---
description: PTY session lifecycle — spawn, suspend/resume, multi-attach, kill, expiry, activity tracking, and daemon-sync across reconnects.
order: 7
---

# Terminal Relay

Engy provides persistent, multiplexed terminal sessions that survive browser
disconnects and daemon reconnects. The relay spans two WebSocket endpoints and
two packages: the server side in `web/src/server/ws/terminal-server.ts`
(`createTerminalWebSocketServer` for `/ws/terminal`, `createTerminalRelayWebSocketServer`
for `/ws/terminal-relay`) and the daemon side in `client/src/terminal/manager.ts`
(`TerminalManager`), `client/src/terminal/session-manager.ts` (`SessionManager`),
and `client/src/terminal/circular-buffer.ts` (`CircularBuffer`).

## Architecture

Browser xterm panes connect to `/ws/terminal` with `sessionId`, `workingDir`,
`cols`, `rows`, `scopeType`, and `scopeLabel` as URL query parameters. The server
relays those connections through `/ws/terminal-relay` to the daemon, which owns
the actual PTY processes. The two-layer design allows the server to run remotely
while PTYs live on the developer's machine.

Server state is held in `AppState` (defined in `web/src/server/trpc/context.ts`):

- `terminalSessions: Map<sessionId, Set<WebSocket>>` — all browser sockets
  currently attached to a session (supports multi-attach).
- `terminalSessionMeta: Map<sessionId, TerminalSessionMeta>` — spawn parameters
  and activity state, kept alive across browser disconnects so sessions can be
  respawned when the daemon reconnects.
- `terminalDaemon: WebSocket | null` — the single relay socket to the daemon.
- `pendingReconnects: Map<sessionId, Set<WebSocket>>` — tracks which specific
  browser sockets requested a reconnect, so the buffer replay is directed only
  to them and not to every already-attached browser.
- `spawningSessions: Map<sessionId, Promise<void>>` — in-flight spawn gates that
  serialise concurrent connections for the same `sessionId`.
- `daemonTerminalSessions: { synced, ids, syncWaiters }` — the alive session ids
  the daemon last reported via `{ t: 'sync' }` (maintained on spawn/exit/kill),
  whether a sync has been received on the current relay connection, and browser
  connections waiting for that sync before classifying.

The daemon side tracks sessions via `SessionManager` (a typed `Map` wrapper with
a 5-minute expiry constant `SESSION_EXPIRY_MS` and a 30-second cleanup interval
`CLEANUP_INTERVAL_MS`, both in `session-manager.ts`) and buffers PTY output in
`CircularBuffer(1000)` (`circular-buffer.ts`).

## Session lifecycle

**Spawn.** On a fresh browser connection the server sends `{ t: 'spawn', sessionId,
workingDir, cols, rows, scopeType, scopeLabel }` to the daemon. Spawn parameters
are persisted to `terminalSessionMeta` only after the message is sent — this
prevents a second concurrent connection from routing through the reconnect path
before the daemon has processed the spawn. If a `workspaceSlug` is provided
and the workspace has `containerEnabled`, `maybeStartContainer` runs first:
it starts the devcontainer via `dispatchContainerUp` or sets `coderWorkspace`
for Coder execution, streaming progress lines as terminal output until the
container is ready.

**Suspend / resume.** The daemon self-suspends active sessions when its own
`/ws/terminal-relay` connection to the server drops: the `ws.on('close')` handler
in `client/src/ws/client.ts` calls `TerminalManager.suspend()` for every active
session (sets `session.state = 'suspended'` and records `suspendedAt`). On the
server side, when the last browser socket for a session closes, the server simply
removes that browser WS from the session set and retains `terminalSessionMeta`
— no suspend message is sent to the daemon. PTY output continues to be captured
into the `CircularBuffer` but is not forwarded. When a browser reconnects (or a second browser attaches to
a live session), the server sends `{ t: 'reconnect', sessionId }`. The daemon
replies with `{ t: 'reconnected', sessionId, buffer }` containing the buffered
lines; the server delivers this replay exclusively to the browsers tracked in
`pendingReconnects`, not to all attached browsers.

**Multi-attach.** Multiple browsers can attach to the same session simultaneously.
The `terminalSessions` map stores a `Set<WebSocket>` per session. All subsequent
`{ t: 'o' }` output is broadcast to every member of the set via
`broadcastToSession`. Input from any attached browser is forwarded raw to the
daemon. When one browser disconnects the session entry is kept; it is removed
only when the set empties.

**Kill.** A browser sends `{ t: 'kill', sessionId }`. The server intercepts it
before forwarding: deletes `terminalSessionMeta`, sends `{ t: 'exit', sessionId,
exitCode: 0 }` to every other attached browser and closes their sockets (code
1001), then removes the session from `terminalSessions` and broadcasts
`destroyed`. The kill message is also forwarded to the daemon so `TerminalManager.kill()`
sends SIGTERM and schedules SIGKILL after 3 seconds (`SIGTERM_TIMEOUT_MS = 3_000`
at `manager.ts:9`).

**Resize.** Browsers send `{ t: 'resize', sessionId, cols, rows }` whenever the
fitted xterm dimensions change. The server updates `cols`/`rows` on the session's
`terminalSessionMeta` entry before forwarding, so the meta always reflects the
last known size rather than the initial spawn size. This matters because the
browser only resends a resize when its fitted dimensions change — it assumes the
PTY already has whatever it last sent, so any server-side respawn or dropped
resize must be healed from the meta, not the browser.

**PTY natural exit.** When the PTY process exits the daemon sends `{ t: 'exit',
sessionId, exitCode }`. The server forwards it to all attached browsers, removes
both maps, and broadcasts `destroyed`.

**Expiry.** `SessionManager.cleanup()` runs on a 30-second interval. Suspended
sessions that have been disconnected for more than 5 minutes (`SESSION_EXPIRY_MS`
in `session-manager.ts`) trigger the expire callback, which sends `{ t: 'exit',
sessionId, exitCode: -1 }` to the server.

**Daemon disconnect / reconnect.** When the `/ws/terminal-relay` socket closes,
`state.terminalDaemon` is set to `null` but `terminalSessionMeta` is kept intact.
When a new daemon connects it sends `{ t: 'sync', sessionIds: [...] }`. The
server records that alive set in `daemonTerminalSessions.ids`, then compares its
meta map against it: sessions absent from the daemon that have an open browser
are respawned transparently (with container config restored from the DB, at the
last known `cols`/`rows`); sessions with no open browser are purged from both
maps. Sessions the daemon still has get a `{ t: 'resize' }` with the last known
size re-asserted if a browser is attached — resizes sent while the relay was
down were dropped, and the browser will not resend them.

**Server restart.** The mirror scenario — the server restarts (e.g. `pnpm
cycle-web`) while the daemon keeps its PTYs alive — wipes all in-memory state,
including `terminalSessionMeta`. Classifying a reconnecting browser by meta
alone would send a fresh `spawn`, and the daemon's `spawnPty` kills any existing
PTY with the same `sessionId` — destroying the session the restart was supposed
to preserve. Two mechanisms prevent this: a browser connect whose `sessionId`
has no meta first waits (up to `DAEMON_SYNC_WAIT_MS = 10_000` in
`terminal-server.ts`) for the daemon's sync if none has been received on the
current relay connection; then, if the daemon reported that session alive, the
server *adopts* it — rebuilding `terminalSessionMeta` from the connection's
query parameters (which carry all meta fields) and routing through the reconnect
path. Sessions with no attached browser at restart time are not adopted; their
ids are known but their meta is unrecoverable, so they idle on the daemon until
expiry.

## Concurrent spawn serialisation

React Strict Mode mounts components twice, causing two simultaneous `/ws/terminal`
connections for the same `sessionId`. The server installs a `Promise` in
`state.spawningSessions` synchronously (before any `await`) on the first
connection. The second connection awaits that gate, then re-classifies: if
`terminalSessionMeta` was set by the first connection it routes through the
reconnect path; if the first spawn was abandoned (no meta) it falls through to
its own fresh spawn.

## Activity tracking

The daemon feeds PTY output through `createTerminalActivityParser` (in
`client/src/terminal/activity-parse.ts`) to detect bell (`hasBell`) and prompt
(`hasPrompt`) signals. `createActivityTracker` (`client/src/terminal/activity-tracker.ts`)
debounces these signals with a 3-second window (`ACTIVITY_DEBOUNCE_MS = 3_000`
at `manager.ts:13`) and emits `{ t: 'act', sessionId, state }` messages —
`idle`, `active`, `waiting`, or `done`. Tracking runs even while a session is
suspended. The server stores `activityState` on `terminalSessionMeta` and
broadcasts a per-project delta via `broadcastTerminalActivityChange`.

## Security

`TerminalManager.spawn()` tests the `command` string against `DANGEROUS_FLAG_RE`
(`/(?:^|\s)--dangerously-skip-permissions(?:\s|$)/` at `manager.ts:10`) before
calling `pty.spawn()`. On a match it sends `{ t: 'exit', sessionId, exitCode: 1 }`
and returns without spawning, unless `isIsolated` is true (`isIsolated =
!!containerWorkspaceFolder || !!opts.coderWorkspace`).

## Requirements

Functional requirements in EARS notation. These are the single source of truth
for the terminal-relay feature's behaviour. Tag the verifying tests with the FR id
in their title string, e.g. `it('[FR-TERMINAL-010] ...', ...)`, and run
`trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-TERMINAL-010 | WHEN a browser connects to `/ws/terminal` without a `sessionId` or without a `workingDir` query parameter, the system SHALL close the WebSocket with code 1008. |
| FR-TERMINAL-020 | WHEN a browser connects to `/ws/terminal` with valid `sessionId` and `workingDir` and no session for that id exists, the system SHALL send `{ t: 'spawn', sessionId, workingDir, cols, rows, scopeType, scopeLabel }` to the daemon relay and persist the session metadata in `terminalSessionMeta`. |
| FR-TERMINAL-030 | WHEN a new terminal session is successfully spawned, the system SHALL broadcast a `created` terminal-sessions change event. |
| FR-TERMINAL-040 | WHEN all browser sockets for a session close, the system SHALL set the daemon-side session state to `suspended`, retain `terminalSessionMeta`, and buffer subsequent PTY output in `CircularBuffer(1000)` without forwarding it to any browser. |
| FR-TERMINAL-050 | WHEN a browser reconnects with a `sessionId` whose metadata is already present, the system SHALL send `{ t: 'reconnect', sessionId }` to the daemon and deliver the `{ t: 'reconnected', sessionId, buffer }` reply exclusively to the browsers that issued the reconnect request, not to all attached browsers. |
| FR-TERMINAL-060 | WHILE multiple browsers are attached to the same session, the system SHALL broadcast every `{ t: 'o' }` output frame to all attached browser sockets and forward input from any attached browser raw to the daemon. |
| FR-TERMINAL-070 | WHEN one browser disconnects from a session that still has other attached browsers, the system SHALL retain the session entry and continue delivering output to the remaining browsers; the entry SHALL be removed only when all attached browsers have disconnected. |
| FR-TERMINAL-080 | WHEN a browser sends `{ t: 'kill', sessionId }`, the system SHALL delete session metadata, send `{ t: 'exit', sessionId, exitCode: 0 }` to every other attached browser and close their sockets with code 1001, remove the session entry, forward the kill message to the daemon (which SHALL send SIGTERM and escalate to SIGKILL after 3 seconds), and broadcast a `destroyed` terminal-sessions change event. |
| FR-TERMINAL-090 | WHEN the PTY process exits on the daemon side, the system SHALL forward `{ t: 'exit', sessionId, exitCode }` to all attached browsers, remove the session from both `terminalSessions` and `terminalSessionMeta`, and broadcast a `destroyed` terminal-sessions change event. |
| FR-TERMINAL-100 | WHEN the `/ws/terminal-relay` socket closes, the system SHALL set `terminalDaemon` to null and retain all `terminalSessionMeta` entries so sessions can be respawned when a new daemon connects. |
| FR-TERMINAL-110 | WHEN a newly connected daemon sends `{ t: 'sync', sessionIds }`, the system SHALL respawn (with container/coder config restored) every session in `terminalSessionMeta` absent from the daemon list that has at least one open browser socket, and SHALL remove entries absent from the daemon list that have no open browser socket. |
| FR-TERMINAL-120 | WHEN two browser connections for the same `sessionId` arrive concurrently before the first spawn completes, the system SHALL serialise them so the second connection routes through the reconnect path once the first spawn resolves, rather than spawning a duplicate PTY. |
| FR-TERMINAL-130 | WHILE a session is active or suspended, the system SHALL parse PTY output for bell and prompt signals, debounce the signals with a 3-second window, and send `{ t: 'act', sessionId, state }` to the server; the server SHALL store the activity state on session metadata and broadcast a per-project terminal-activity change event. |
| FR-TERMINAL-140 | IF a spawn command on a host-mode session (no `containerWorkspaceFolder` and no `coderWorkspace`) contains `--dangerously-skip-permissions`, the system SHALL send `{ t: 'exit', sessionId, exitCode: 1 }` and not spawn the PTY. |
| FR-TERMINAL-150 | WHEN a browser sends `{ t: 'resize', sessionId, cols, rows }`, the system SHALL update `cols`/`rows` on the session's `terminalSessionMeta` entry, so that respawn and size re-assertion use the last known terminal size instead of the initial spawn size. |
| FR-TERMINAL-160 | WHEN a newly connected daemon sends `{ t: 'sync', sessionIds }`, the system SHALL send `{ t: 'resize', sessionId, cols, rows }` with the last known size to the daemon for every session in the daemon list that has at least one open browser socket, so resizes dropped during a relay outage are healed. |
| FR-TERMINAL-170 | WHEN a client requests the global terminal list via `GET /api/terminal/sessions?all=1`, the system SHALL return every session in `terminalSessionMeta`, each carrying `projectSlug`, `worktreeBranch`, and `activityState`. |
| FR-TERMINAL-180 | WHILE Command Center mode is enabled (a global toggle in the terminal rail, shared across all project tabs), the terminal sidebar's existing rail and dock SHALL list every terminal across all projects — grouped by project then by worktree branch, with project-less sessions in a trailing bucket — instead of only the current project's; toggling it off SHALL restore the current project's terminals. |
| FR-TERMINAL-190 | WHILE Command Center mode is enabled, WHEN the user activates a project group's new-terminal control, the system SHALL open a new terminal whose scope is cloned from that group's first terminal — base label without any trailing ordinal suffix, no task binding — so the session registers under that project's own groupKey; the generic new-terminal controls (rail and dock header) SHALL be disabled while the mode is on, so creation cannot silently target the current project. |
| FR-TERMINAL-200 | WHEN a browser connects with a `sessionId` that has no `terminalSessionMeta` entry but is present in the daemon's last-synced alive session set, the system SHALL rebuild the session metadata from the connection's query parameters and route the connection through the reconnect path instead of spawning a new PTY, so live sessions survive a server restart. |
| FR-TERMINAL-210 | WHEN a browser connects with a `sessionId` that has no `terminalSessionMeta` entry and no daemon session sync has been received on the current relay connection, the system SHALL wait up to 10 seconds for the daemon's `{ t: 'sync' }` before classifying the connection as spawn or reconnect. |

## Sources

No prior knowledge found.
