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
(`TerminalManager`) and `client/src/terminal/session-manager.ts` (`SessionManager`).

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
  browser sockets requested a reconnect, so the snapshot resync is directed only
  to them and not to every already-attached browser.
- `spawningSessions: Map<sessionId, Promise<void>>` — in-flight spawn gates that
  serialise concurrent connections for the same `sessionId`.
- `daemonTerminalSessions: { synced, ids, syncWaiters }` — the alive session ids
  the daemon last reported via `{ t: 'sync' }` (maintained on spawn/exit/kill),
  whether a sync has been received on the current relay connection, and browser
  connections waiting for that sync before classifying.

`terminalSessionMeta` is additionally mirrored to the `terminal_sessions`
SQLite table (`web/src/server/ws/terminal-session-store.ts`): written through
on every meta mutation (spawn, adoption, groupKey update, resize, activity),
deleted on exit/kill/sync-purge, and restored into the map at server boot
(`loadPersistedTerminalSessions` in `web/server.ts`). Persistence is
best-effort — DB failures are logged and never interrupt the relay.

The daemon side tracks sessions via `SessionManager` (a typed `Map` wrapper with
a 5-minute expiry constant `SESSION_EXPIRY_MS` and a 30-second cleanup interval
`CLEANUP_INTERVAL_MS`, both in `session-manager.ts`). Every session feeds its raw
PTY output into a per-session `@xterm/headless` terminal (5000-line scrollback,
sized with the PTY) whose serialized state — via `@xterm/addon-serialize` — is
the replay source for reconnecting browsers. Raw chunk history is never replayed:
TUI repaint frames are cursor-relative and only render correctly against the
live screen they were emitted into.

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
— no suspend message is sent to the daemon. PTY output continues to be written
into the headless terminal but is not forwarded. When a browser reconnects (or a second browser attaches to
a live session), the server sends `{ t: 'reconnect', sessionId }`. The daemon
flushes the headless terminal's write queue and replies with
`{ t: 'reconnected', sessionId, snapshot }` — the serialized screen plus
scrollback; the server delivers this resync exclusively to the browsers tracked
in `pendingReconnects` (followed by the session's stored `lastTitle`, since the
snapshot carries no OSC title), not to all attached browsers. The browser resets
its xterm and writes the snapshot in place of whatever it had.

**Wake probing.** The browser's `ReconnectingSocket` listens for
`visibilitychange`/`online`. On wake with an OPEN socket it does not blindly
force-reconnect: it sends `{ t: 'ping' }`, which the server answers directly with
`{ t: 'pong' }` (never forwarded to the daemon), and only if no pong arrives
within 3 seconds is the socket treated as a post-sleep zombie and
force-reconnected. Ordinary tab switches therefore keep the socket — and the
xterm's accumulated scrollback — intact.

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
to preserve. Three mechanisms prevent this. First, the restarted server reloads
`terminalSessionMeta` from the `terminal_sessions` SQLite mirror at boot, so
sessions with no attached browser stay listed and reattachable. Second, until a
sync has been received on the current relay connection, browser connects for
sessions without trusted local state — no meta at all, or meta restored from
the DB and not yet validated (`state.restoredTerminalSessions`) — wait (up to
`DAEMON_SYNC_WAIT_MS = 10_000` in `terminal-server.ts`) for the daemon's sync
before classifying; a no-meta connect would otherwise spawn over a surviving
PTY. Live sessions with in-memory meta skip the wait. Third, if the daemon reported a session
alive that the server has no meta for (e.g. the DB row was lost), the server
*adopts* it — rebuilding `terminalSessionMeta` from the connection's query
parameters (which carry all meta fields) and routing through the reconnect
path. Restored entries the daemon no longer has are purged (and their rows
deleted) by the existing sync reconciliation.

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

Three healing paths keep the stored/browser state from drifting when messages
are dropped: the daemon's reconnect sync carries every live session's current
activity state so the server adopts states missed during a relay outage; the
browser's project-activity store re-seeds from `GET /api/terminal/activity`
whenever the `/ws/events` socket (re)connects; and focusing a terminal sends
`{ t: 'ack', sessionId }`, which the server intercepts (clears `activityState`
to `idle` and broadcasts) before forwarding to the daemon so its tracker
settles too — matching the in-browser rail, where viewing a terminal
acknowledges a `done`/`waiting` indicator.

## Security

`TerminalManager.spawn()` tests the `command` string against `DANGEROUS_FLAG_RE`
(`client/src/terminal/manager.ts`) before calling `pty.spawn()`. The regex
covers per-CLI permission-bypass flags — Claude Code's
`--dangerously-skip-permissions` and Codex's
`--dangerously-bypass-approvals-and-sandbox`. On a match it sends
`{ t: 'exit', sessionId, exitCode: 1 }` and returns without spawning, unless
`isIsolated` is true (`isIsolated = !!containerWorkspaceFolder ||
!!opts.coderWorkspace`).

## Cross-terminal dispatch

Terminal sessions can be connected as **dispatch workers**
(`terminal.connectWorker` tRPC mutation, with a user-supplied description).
Agents in other sessions dispatch prompts to workers via the `terminal_*` MCP
tools (see the MCP Server Session feature). Delivery writes into the worker's
PTY stdin over the existing input path (`web/src/server/terminal-dispatch.ts`):
the message plus a reply contract is sent as a bracketed paste, followed by
Enter after a per-agent-type delay (`AgentPasteBehavior` in
`web/src/lib/agent-types.ts`). For workers whose CLI carries a per-session MCP
endpoint the contract is a bare `[engy-dispatch]` marker ("report the outcome
via terminal_reply" — the server matches the reply by the worker's identity);
workers without one get the legacy `[engy-dispatch <correlationId>]` form and
must echo the id. Delivery is idle-gated: dispatches to a busy worker queue in
a per-worker inbox and flush one at a time on `act → idle/done` transitions —
queued settled-dispatch notices for that terminal (see FR-MCP-180) flush first.
The relay keeps a bounded output tail for connected workers so
`terminal_status` can report recent output.

## Session resume

Claude terminals adopt the terminal's own session id as the CLI conversation id
(`--session-id __ENGY_SESSION__` in `buildAgentCommand`, substituted at spawn),
so past conversations are addressable for `claude --resume`. A write-ahead
history table (`terminal_session_history`,
`web/src/server/ws/terminal-session-history.ts`) gets an upserted row the
moment an agent terminal spawns — teardown only stamps `closedAt`, so no crash
timing loses a session. The browser reports OSC title changes over the terminal
socket (`{ t: 'title' }`, server-terminated) and the last title becomes the
row's summary. The new-terminal dropdown's "Resume Session" group
(`terminal.listSessionHistory` tRPC query + `session-history-entries.ts`) lists
closed sessions per repo/worktree and reopens them in their original cwd with
`claude --resume <id>`; resumed terminals carry `resumedFrom` so history keeps
tracking the original conversation. Codex cannot be assigned a session id at
spawn, so directories with recorded Codex sessions get a "Resume Codex
session…" entry that launches `codex resume` (the CLI's own cwd-filtered
picker). When the daemon loses a PTY
and the server respawns it, `--session-id` is rewritten to `--resume` so the
conversation continues instead of failing on a duplicate id.

## Viewport scrolling

The browser pane (`web/src/components/terminal/terminal.tsx`) leaves auto-follow
to xterm's own `isUserScrolling` state rather than mirroring it: scrolling into
the scrollback stops output from following the bottom, and reaching the bottom
resumes it. The pane only reads the buffer, to show a "Bottom" button while the
view sits above `baseY`. Two gestures need help. An upward wheel from the bottom
gets a forced one-line scroll, because while following, each write resets the
viewport and sub-line trackpad deltas never accumulate.

Touch drags are handled outright (`touch-scroll.ts` converts drag pixels to
whole lines), because xterm's own touch handlers bail out while a program has
mouse reporting on — which agent TUIs do — and native scrolling only covers the
margins beyond the last row and column, where a drag reaches `.xterm-viewport`
instead of the `.xterm-screen` overlay. The pane uses **pointer** events and
takes a pointer capture on the container at `pointerdown`, rather than touch
events: a finger lands on a `<span>` inside a row, and the first line scrolled
makes xterm re-render that row and destroy the span, at which point iOS Safari
stops delivering the gesture (Chrome retargets detached nodes, so this only
reproduces on a device). The capture keeps the rest of the drag on the
container. The container's `touch-action: pinch-zoom` is part of the mechanism —
a browser-claimed pan cancels the pointer stream — and is the narrowest value
that still works, so two-finger zoom stays with the browser. The trade-off is
that a single-finger drag always scrolls and can never select text; xterm's
selection is mouse-driven and never worked from touch anyway.

## Mobile compose

Typing straight into xterm's hidden textarea is unreliable on mobile: Chrome for
Android ignores the `autocorrect`/`spellcheck` attributes xterm sets
(crbug.com/901839), and Gboard's composition events duplicate and jumble
characters (xterm.js#3600). The pane sets `inputmode` on that textarea to get an
input type Android treats as suggestion-free, and a floating pencil button in the
pane's bottom-right corner opens `mobile-composer.tsx` — a full-pane overlay with
a plain textarea, every keyboard nicety left on, and a working Enter key for
newlines. Send delivers the text as one bracketed paste (`bracketed-paste.ts`)
followed by a separate Enter, so line breaks stay line breaks and no
per-keystroke composition reaches the PTY.

Both the pencil and the overlay's Cancel/Send row sit at the bottom, under the
thumb. Keeping them clear of the keyboard is normally the platform's job —
`app/layout.tsx` sets `interactive-widget: resizes-content`, so the layout
viewport shrinks and the actions ride up on their own. `use-keyboard-inset.ts`
is the fallback for engines that ignore that hint (iOS Safari before 17.4),
which shrink only the visual viewport: it reports the difference as keyboard
height and the overlay pads itself by that much. On engines that honour the
hint it correctly reports zero.

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
| FR-TERMINAL-040 | WHEN all browser sockets for a session close, the system SHALL set the daemon-side session state to `suspended`, retain `terminalSessionMeta`, and continue writing PTY output into the session's headless terminal mirror (5000-line scrollback) without forwarding it to any browser. |
| FR-TERMINAL-050 | WHEN a browser reconnects with a `sessionId` whose metadata is already present, the system SHALL send `{ t: 'reconnect', sessionId }` to the daemon and deliver the `{ t: 'reconnected', sessionId, snapshot }` reply — the serialized screen and scrollback of the session's headless terminal, serialized only after its write queue has drained — exclusively to the browsers that issued the reconnect request, not to all attached browsers. |
| FR-TERMINAL-060 | WHILE multiple browsers are attached to the same session, the system SHALL broadcast every `{ t: 'o' }` output frame to all attached browser sockets and forward input from any attached browser raw to the daemon. |
| FR-TERMINAL-070 | WHEN one browser disconnects from a session that still has other attached browsers, the system SHALL retain the session entry and continue delivering output to the remaining browsers; the entry SHALL be removed only when all attached browsers have disconnected. |
| FR-TERMINAL-080 | WHEN a browser sends `{ t: 'kill', sessionId }`, the system SHALL delete session metadata, send `{ t: 'exit', sessionId, exitCode: 0 }` to every other attached browser and close their sockets with code 1001, remove the session entry, forward the kill message to the daemon (which SHALL send SIGTERM and escalate to SIGKILL after 3 seconds), and broadcast a `destroyed` terminal-sessions change event with `reason: 'killed'` (on which browsers remove the terminal tab). |
| FR-TERMINAL-090 | WHEN the PTY process exits on the daemon side for a session still known to the server, the system SHALL forward `{ t: 'exit', sessionId, exitCode }` to all attached browsers, remove the session from both `terminalSessions` and `terminalSessionMeta`, and broadcast a `destroyed` terminal-sessions change event without a `reason` (the tab stays visible with its final output); an exit for a session already torn down (killed or agent-closed) SHALL be ignored rather than re-broadcast. |
| FR-TERMINAL-100 | WHEN the `/ws/terminal-relay` socket closes, the system SHALL set `terminalDaemon` to null and retain all `terminalSessionMeta` entries so sessions can be respawned when a new daemon connects. |
| FR-TERMINAL-110 | WHEN a newly connected daemon sends `{ t: 'sync', sessionIds }`, the system SHALL respawn (with container/coder config restored) every session in `terminalSessionMeta` absent from the daemon list that has at least one open browser socket; entries absent from the daemon list with no open browser socket SHALL be removed fully — session meta deleted, unsettled dispatches failed, the dispatch-worker entry dropped, and a `destroyed` terminal-sessions change broadcast. |
| FR-TERMINAL-120 | WHEN two browser connections for the same `sessionId` arrive concurrently before the first spawn completes, the system SHALL serialise them so the second connection routes through the reconnect path once the first spawn resolves, rather than spawning a duplicate PTY. |
| FR-TERMINAL-130 | WHILE a session is active or suspended, the system SHALL parse PTY output for bell and prompt signals, debounce the signals with a 3-second window, and send `{ t: 'act', sessionId, state }` to the server; the server SHALL store the activity state on session metadata and broadcast a per-project terminal-activity change event. |
| FR-TERMINAL-140 | IF a spawn command on a host-mode session (no `containerWorkspaceFolder` and no `coderWorkspace`) contains a permission-bypass flag (`--dangerously-skip-permissions` or `--dangerously-bypass-approvals-and-sandbox`), the system SHALL send `{ t: 'exit', sessionId, exitCode: 1 }` and not spawn the PTY. |
| FR-TERMINAL-150 | WHEN a browser sends `{ t: 'resize', sessionId, cols, rows }`, the system SHALL update `cols`/`rows` on the session's `terminalSessionMeta` entry, so that respawn and size re-assertion use the last known terminal size instead of the initial spawn size. |
| FR-TERMINAL-160 | WHEN a newly connected daemon sends `{ t: 'sync', sessionIds }`, the system SHALL send `{ t: 'resize', sessionId, cols, rows }` with the last known size to the daemon for every session in the daemon list that has at least one open browser socket, so resizes dropped during a relay outage are healed. |
| FR-TERMINAL-170 | WHEN a client requests the global terminal list via `GET /api/terminal/sessions?all=1`, the system SHALL return every session in `terminalSessionMeta`, each carrying `projectSlug`, `worktreeBranch`, and `activityState`. |
| FR-TERMINAL-180 | WHILE Command Center mode is enabled (a global toggle in the terminal rail, shared across all project tabs), the terminal sidebar's existing rail and dock SHALL list every terminal across all projects — grouped by project then by worktree branch, with project-less sessions in a trailing bucket — instead of only the current project's; toggling it off SHALL restore the current project's terminals. |
| FR-TERMINAL-190 | WHILE Command Center mode is enabled, WHEN the user activates a project group's new-terminal control, the system SHALL open a new terminal whose scope is cloned from that group's first terminal — base label without any trailing ordinal suffix, no task binding — so the session registers under that project's own groupKey; the generic new-terminal controls (rail and dock header) SHALL be disabled while the mode is on, so creation cannot silently target the current project. |
| FR-TERMINAL-200 | WHEN a browser connects with a `sessionId` that has no `terminalSessionMeta` entry but is present in the daemon's last-synced alive session set, the system SHALL rebuild the session metadata from the connection's query parameters and route the connection through the reconnect path instead of spawning a new PTY, so live sessions survive a server restart. |
| FR-TERMINAL-210 | WHEN a browser connects for a session with no in-memory metadata, or whose metadata was restored from the database and not yet validated by a daemon sync, and no sync has been received on the current relay connection, the system SHALL wait up to 10 seconds for the daemon's `{ t: 'sync' }` before classifying the connection as spawn or reconnect. |
| FR-TERMINAL-220 | The system SHALL mirror `terminalSessionMeta` to the `terminal_sessions` SQLite table — written through on meta creation and mutation, deleted on exit/kill/sync-purge — and SHALL restore the persisted entries into `terminalSessionMeta` at server boot, so sessions with no attached browser survive a server restart. |
| FR-TERMINAL-230 | WHEN a newly connected daemon sends `{ t: 'sync' }`, the daemon SHALL include each live session's current activity state, and the server SHALL adopt any state that differs from the stored `activityState` — persisting it and broadcasting a per-project terminal-activity change — so activity transitions dropped during a relay outage are healed. |
| FR-TERMINAL-240 | WHEN the user focuses a terminal in a browser, the browser SHALL send `{ t: 'ack', sessionId }`; the server SHALL clear the session's stored `activityState` to `idle` (persisting and broadcasting the change) and forward the ack to the daemon, whose activity tracker SHALL settle to idle — so a done/waiting badge clears once the terminal is viewed, matching the in-browser rail indicator. |
| FR-TERMINAL-250 | WHEN the browser's `/ws/events` socket (re)connects, the system SHALL re-seed the project-activity store from `GET /api/terminal/activity`, replacing the full session set, so activity deltas broadcast while the socket was disconnected are healed. |
| FR-TERMINAL-260 | WHEN a browser connects to `/ws/terminal` with an `agentType` query parameter, the system SHALL persist it on the session metadata and include it in the session list endpoint. |
| FR-TERMINAL-270 | WHEN a dispatch is created for a connected worker whose activity state is idle or done and whose inbox is empty, the system SHALL immediately inject the message plus the reply contract into the worker's PTY as a bracketed paste, followed by Enter after the worker agent type's submit delay; the contract SHALL be the id-less `[engy-dispatch]` form when the worker's command carries its per-session `/mcp/<sessionId>` endpoint, and the `[engy-dispatch <correlationId>]` form otherwise. |
| FR-TERMINAL-280 | WHEN a dispatch is created for a worker that is active, waiting, or has queued dispatches, the system SHALL queue it in the per-worker inbox; WHEN the worker's activity state transitions to idle or done, the system SHALL deliver exactly one queued dispatch. |
| FR-TERMINAL-290 | WHEN a worker terminal exits or is killed, the system SHALL mark all its queued and delivered dispatches as failed, resolve any waiters, remove the session from the connected-worker set, and drop its output tail. |
| FR-TERMINAL-300 | WHILE a session is connected as a dispatch worker, the system SHALL buffer its PTY output in a bounded tail (8192 characters) for status reporting. |
| FR-TERMINAL-310 | WHEN spawning a terminal whose command contains the MCP session placeholder (`__ENGY_SESSION__`), the system SHALL substitute the session id before sending the spawn to the daemon and SHALL store the substituted command in `terminalSessionMeta`, so the agent's Engy MCP endpoint is `/mcp/<sessionId>`. |
| FR-TERMINAL-320 | WHEN building a Claude terminal command without a resume target, the system SHALL include `--session-id __ENGY_SESSION__` so the spawned CLI adopts the terminal's session id (substituted at spawn per FR-TERMINAL-310, including server-originated `terminal_spawn` spawns), making the conversation addressable for later resume. |
| FR-TERMINAL-330 | WHEN the browser detects an OSC 0/2 title change on a terminal, it SHALL send `{ t: 'title', sessionId, title }` on the terminal socket; the server SHALL sanitize it, store it as `lastTitle` on the session metadata, update the session's history-row summary, and SHALL NOT forward the message to the daemon. |
| FR-TERMINAL-340 | WHEN an agent terminal session (metadata carries `agentType`) is spawned, the system SHALL upsert a session-history row keyed by the session's agent-CLI session id (`resumedFrom` when the terminal is a resume, else the terminal `sessionId`) carrying agentType, workingDir, scopeLabel, summary (initially `scopeLabel`), workspaceSlug, projectSlug, worktreeBranch, containerMode, and startedAt — so the row exists even if the daemon or machine dies mid-session; WHEN the session is torn down (daemon exit, kill/destroy, or daemon-sync purge) the system SHALL stamp `closedAt` on the row. History SHALL be pruned to the newest 50 rows per workspace; sessions without `agentType` SHALL NOT be recorded. |
| FR-TERMINAL-350 | WHEN the client queries recent session history for a workspace, the system SHALL return stored rows newest-first, excluding rows whose key matches a currently-live session's `resumedFrom` or `sessionId`, so open terminals never appear as resumable. |
| FR-TERMINAL-360 | WHEN the user activates a resume entry in the new-terminal dropdown, the system SHALL open a new terminal in the history row's original workingDir (and original containerMode) whose command is `claude --resume <session-id>` plus the standard MCP config, permission-mode, and `--add-dir` flags — and without `--session-id` — and SHALL tag the new session's metadata with `resumedFrom: <session-id>`. |
| FR-TERMINAL-370 | WHILE the Codex agent is active, the new-terminal dropdown SHALL offer a "Resume Codex session…" entry for each directory with recorded Codex session history, opening a terminal running `codex resume` (the CLI's interactive picker) in that directory; directories without any session history SHALL NOT appear in the resume group. |
| FR-TERMINAL-380 | WHEN the server respawns a session whose stored command contains `--session-id <id>` (daemon lost the PTY), it SHALL rewrite the flag to `--resume <id>` before sending the spawn, so the respawned CLI continues the conversation instead of failing on a duplicate session id. |
| FR-TERMINAL-390 | WHILE the user drags a single touch point across a terminal pane, the system SHALL scroll the terminal buffer by the whole lines the drag covers — for the whole drag, wherever it started, and whether or not the running program has mouse reporting on — carrying sub-line movement over to later moves within the same drag and discarding it when a new drag starts; WHILE the pane's row height is not measurable (a hidden pane), it SHALL NOT scroll. |
| FR-TERMINAL-400 | WHEN the user sends a message from the mobile compose overlay, the system SHALL deliver it to the PTY as a single bracketed paste with line breaks as carriage returns and any paste sentinels in the text stripped, followed by a separate Enter. |
| FR-TERMINAL-410 | WHEN the browser wakes (`visibilitychange` to visible, or `online`) while its terminal socket is OPEN, the system SHALL send `{ t: 'ping' }` — answered by the server with `{ t: 'pong' }` without daemon involvement — and force-reconnect the socket only IF no pong arrives within 3 seconds; WHEN the socket is not OPEN on wake it SHALL reconnect immediately. |
| FR-TERMINAL-420 | WHEN the server forwards a `reconnected` snapshot to the pending browsers of a session that has a stored `lastTitle`, it SHALL follow the snapshot with `{ t: 'title', sessionId, title }` to those same browsers. |

## Sources

No prior knowledge found.
