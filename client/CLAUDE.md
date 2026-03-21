# Client Package

Local Node.js daemon that runs on the developer's machine. Connects to the web server via WebSocket. Handles path validation, file watching, git operations, and terminal session management.

See root `CLAUDE.md` for monorepo commands (`pnpm dev`, `pnpm blt`).

## Directory Structure

```
src/
├── index.ts                  # Entry point — orchestrates all daemon components
├── watcher.ts                # File system watcher (chokidar) for spec/project dirs
├── ws/
│   └── client.ts             # WebSocket client — dual connections, auto-reconnect
├── git/
│   └── index.ts              # Git operations (status, diff, log, show, branch files, worktrees)
└── terminal/
    ├── types.ts              # SessionState, PersistentSession interfaces
    ├── circular-buffer.ts    # Ring buffer for terminal output (1000 lines)
    ├── session-manager.ts    # Session storage (typed Map wrapper)
    └── manager.ts            # PTY spawning, I/O relay, suspend/resume
```

## Architecture

### Daemon Pattern

The process stays alive and maintains state: file watchers, terminal sessions, WebSocket connections. Entry point (`index.ts`) initializes all components and sets up graceful shutdown (SIGINT/SIGTERM).

### Dual WebSocket Connections

Two separate connections to the web server:
1. **Main** (`/ws`) — server requests (path validation, file search, git ops) + file change notifications
2. **Terminal relay** (`/ws/terminal-relay`) — raw terminal I/O between browser xterm and local PTY

Both auto-reconnect with exponential backoff (1s → 30s max, 20% jitter).

### Module Responsibilities

| Module | Role |
|--------|------|
| `ws/client.ts` | Handles all server↔client message routing. Dispatches to git/terminal handlers. |
| `watcher.ts` | Watches `{ENGY_DIR}/{workspace}/specs` and `projects` dirs. Sends `FILE_CHANGE` messages. |
| `git/index.ts` | Executes git commands via `simple-git` and `execFile`. Returns structured results. |
| `terminal/manager.ts` | Spawns PTY processes (`node-pty`), relays I/O, manages suspend/resume lifecycle. |
| `terminal/session-manager.ts` | Typed session storage (Map wrapper). |

## Key Patterns

### Terminal Session Lifecycle

Sessions transition: `active` → `suspended` (on WS disconnect) → `active` (on reconnect, with buffer replay). Circular buffer stores output during suspension for replay.

### Compact Terminal Messages

Terminal I/O uses short keys to reduce bandwidth:
- `{ t: 'o', sessionId, d }` — output data
- `{ t: 'exit', sessionId, exitCode }` — process exit
- `{ t: 'reconnected', sessionId, buffer }` — reconnect with replay

### Git-First File Search

File search prefers `git ls-files` for speed and accuracy, falling back to recursive directory traversal (max depth 10). Skips `.git`, `node_modules`, `dist`, `build`, `.next`, `__pycache__`.

## Testing

Tests are colocated: `module.ts` → `module.test.ts`.

Coverage thresholds (enforced in `vitest.config.ts`): 90% statements, 85% branches, 90% functions, 90% lines. Excludes `src/index.ts`.

Key patterns:
- **Git tests** — real temporary git repos, no mocks
- **WS tests** — mock WebSocketServer, async `waitFor()` helpers
- **Terminal tests** — mock node-pty, test state transitions
- **Watcher tests** — real temp directories + polling mode
