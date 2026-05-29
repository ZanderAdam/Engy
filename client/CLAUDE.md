# Client Package

Local Node.js daemon. Connects to the web server via WebSocket and handles everything the server can't (or shouldn't) do directly: path validation, file watching, git operations, terminal PTYs, devcontainer/coder management, agent process spawning.

See root `CLAUDE.md` for monorepo commands.

## Orientation

- `src/index.ts` — entry point; orchestrates all subsystems and graceful shutdown (SIGINT/SIGTERM).
- `src/ws/client.ts` — WebSocket client. Two connections (see below). Auto-reconnect with exponential backoff (1s → 30s max, 20% jitter). Routes incoming messages to the right subsystem handler.
- `src/watcher.ts` — chokidar watcher over `{ENGY_DIR}/{workspace}/specs` and `projects`. Emits `FILE_CHANGE`.
- `src/git/` — git ops via `simple-git` + `execFile`. Git-first file search (`git ls-files`, fallback to recursive traversal max depth 10 with no name filtering — dotfiles and `node_modules`/build dirs are surfaced). `DIR_LIST_REQUEST` (single-level, used by the Code tab tree) likewise returns every readable entry unfiltered.
- `src/terminal/` — PTY spawning and suspend/resume lifecycle. See `src/terminal/CLAUDE.md` for wire format and security rules.
- `src/container/` — devcontainer + coder workspace lifecycle, devcontainer config generation. Handles `CONTAINER_UP/DOWN/STATUS_*` and `DEVCONTAINER_CONFIG_GENERATE_*` requests.
- `src/runner/` — agent process spawner (Claude Code CLI invocations). Handles `EXECUTION_START/STOP_*` and emits `EXECUTION_STATUS_EVENT` / `EXECUTION_COMPLETE_EVENT`.

## WebSocket connections

Two separate sockets to the server, both auto-reconnecting independently:

1. **`/ws`** — control channel. Server requests (validation, file search, git, container, execution) plus daemon-initiated `FILE_CHANGE` and `WORKSPACES_SYNC` traffic.
2. **`/ws/terminal-relay`** — raw terminal I/O. The server relays bytes between this and browser `/ws/terminal` sockets.

Protocol catalog lives in `common/CLAUDE.md` (~40 message types in `@engy/common/src/ws/protocol.ts`).

## Testing

Tests colocated (`module.ts` → `module.test.ts`). Coverage threshold 90/85/90/90 across `src/**`, excluding `src/index.ts`.

Patterns:
- **Git tests** use real temporary git repos — no mocks.
- **Terminal tests** mock `node-pty`; assert on spawn args and the sequence of outgoing wire messages.
- **WS tests** mock `WebSocketServer` with async `waitFor()` helpers.
- **Watcher tests** use real temp directories in polling mode.
