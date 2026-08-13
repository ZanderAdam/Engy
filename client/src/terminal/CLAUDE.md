# Terminal (Daemon Side)

Spawns and manages PTYs locally; relays I/O to the server over `/ws/terminal-relay`. See `../../CLAUDE.md` for daemon-level overview.

## Files

- `manager.ts` — `TerminalManager`: spawns PTYs (`spawnLocal` / `spawnInContainer` / `spawnInCoder`), relays I/O, manages suspend/resume, mirrors each PTY into an `@xterm/headless` terminal for snapshot resync.
- `session-manager.ts` — Typed `Map` wrapper over `PersistentSession`. Has an expire callback the manager wires up.
- `types.ts` — `SessionState = 'active' | 'suspended'`, `PersistentSession` shape (includes the headless `screen` + `serializeAddon`).

## Lifecycle

`active` → `suspended` on WS disconnect → `active` on reconnect (with snapshot resync via `reconnected` message). Sessions expire after the configured idle window — the expire callback sends `{ t: 'exit', sessionId, exitCode: -1 }` so the server can clean up its mirror.

## Compact message protocol

Server expects these literal short keys — **don't expand to verbose keys** (bandwidth-sensitive, schema is in `@engy/common`):

| Outgoing (to server) | Meaning |
|---|---|
| `{ t: 'o', sessionId, d }` | Output chunk |
| `{ t: 'exit', sessionId, exitCode }` | PTY exited / expired / blocked |
| `{ t: 'reconnected', sessionId, snapshot }` | Resume with a serialized terminal snapshot |
| `{ t: 'act', sessionId, state }` | Activity transition (`idle`/`active`/`waiting`/`done`) — for per-project badges; emitted even while suspended |

Use `this.sendToServer?.(JSON.stringify({...}))` — no helper today, but if you add one, keep the wire shape identical.

## Spawn modes

- Local shell: `spawnLocal` via `node-pty`.
- Devcontainer: `spawnInContainer` shells out via `devcontainer exec --workspace-folder <folder>`.
- Coder workspace: `spawnInCoder` uses `coder ssh --no-wait` with optional reverse port (`-R`) for server callback.

Every mode sets `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` (PTY env locally, `--remote-env`/`-e` for devcontainer/coder) so CLAUDE.md, rules, and skills from `--add-dir` dirs — notably the project docs dir — load into agent context. Mirrored in the runner's `agent-spawner.ts`.

**Security**: the permission-bypass guard (`DANGEROUS_FLAG_RE`) runs at the top of `spawn()` for **every** mode, gated on `!isIsolated` where `isIsolated = !!containerWorkspaceFolder || !!opts.coderWorkspace`. It blocks Claude Code's `--dangerously-skip-permissions` and Codex's `--dangerously-bypass-approvals-and-sandbox` on host; devcontainer and coder are considered isolated and pass. Any new spawn mode must either set one of those isolation flags or stay blocked; any new agent CLI's bypass flag must be added to the regex.

## Screen mirror (replay source)

- Each session owns an `@xterm/headless` terminal (`screen`, 10,000-line scrollback matching the browser xterm, resized alongside the PTY) fed every raw output chunk. On reconnect the daemon flushes its write queue (`screen.write('', cb)`) and sends the `@xterm/addon-serialize` snapshot — never raw chunk history, whose cursor-relative TUI frames tear when replayed against a reset screen. Every session serializes `{ scrollback: SNAPSHOT_SCROLLBACK_LINES }` (5,000 of the mirror's 10,000 lines) — a resync after a refresh restores several browsers at once, so the depth is capped there. Do not key this on whether the session was spawned with a command: a full-screen program draws its frames on the alternate screen, which the serializer appends separately, so the normal buffer holds history either way.
- `@xterm/headless` is a UMD bundle: under Node ESM, `Terminal` is only reachable via the default import (`import headless from '@xterm/headless'`), not as a named export.
- Activity detection (`activity-parse.ts`) stays wired to the raw PTY stream, not the headless terminal's rendered state — that duplication with `web/` is intentional (common/ is types-only).

## Tests

- `node-pty` is **mocked** in tests. Don't require a real PTY for unit tests — assert on the mock's spawn args and the sequence of `sendToServer` calls.
- Session-state transitions (`active` ↔ `suspended`, expiry) and buffer replay are the core invariants to cover.
- Coverage threshold is 90/85/90/90 across `client/src/**` except `src/index.ts`.
