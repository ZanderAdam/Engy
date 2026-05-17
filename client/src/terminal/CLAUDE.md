# Terminal (Daemon Side)

Spawns and manages PTYs locally; relays I/O to the server over `/ws/terminal-relay`. See `../../CLAUDE.md` for daemon-level overview.

## Files

- `manager.ts` — `TerminalManager`: spawns PTYs (`spawnLocal` / `spawnInContainer` / `spawnInCoder`), relays I/O, manages suspend/resume.
- `session-manager.ts` — Typed `Map` wrapper over `PersistentSession`. Has an expire callback the manager wires up.
- `circular-buffer.ts` — Fixed-capacity ring buffer (default 1000 lines) for replay on reconnect.
- `types.ts` — `SessionState = 'active' | 'suspended'`, `PersistentSession` shape.

## Lifecycle

`active` → `suspended` on WS disconnect → `active` on reconnect (with buffer replay via `reconnected` message). Sessions expire after the configured idle window — the expire callback sends `{ t: 'exit', sessionId, exitCode: -1 }` so the server can clean up its mirror.

## Compact message protocol

Server expects these literal short keys — **don't expand to verbose keys** (bandwidth-sensitive, schema is in `@engy/common`):

| Outgoing (to server) | Meaning |
|---|---|
| `{ t: 'o', sessionId, d }` | Output chunk |
| `{ t: 'exit', sessionId, exitCode }` | PTY exited / expired / blocked |
| `{ t: 'reconnected', sessionId, buffer }` | Resume with replay |

Use `this.sendToServer?.(JSON.stringify({...}))` — no helper today, but if you add one, keep the wire shape identical.

## Spawn modes

- Local shell: `spawnLocal` via `node-pty`.
- Devcontainer: `spawnInContainer` shells out via `devcontainer exec --workspace-folder <folder>`.
- Coder workspace: `spawnInCoder` uses `coder ssh --no-wait` with optional reverse port (`-R`) for server callback.

**Security**: the `--dangerously-skip-permissions` guard (`DANGEROUS_FLAG_RE`) runs at the top of `spawn()` for **every** mode, gated on `!isIsolated` where `isIsolated = !!containerWorkspaceFolder || !!opts.coderWorkspace`. Host execution is blocked; devcontainer and coder are considered isolated and pass. Any new spawn mode must either set one of those isolation flags or stay blocked.

## Buffer

- Capacity 1000 lines, fixed. Don't grow ad-hoc — if a feature needs more, justify it and update both ends (server replay logic depends on bounded size).
- `write(line)` is per-line, but PTY output is byte-stream — current code writes whole chunks; preserve that or update consumers.

## Tests

- `node-pty` is **mocked** in tests. Don't require a real PTY for unit tests — assert on the mock's spawn args and the sequence of `sendToServer` calls.
- Session-state transitions (`active` ↔ `suspended`, expiry) and buffer replay are the core invariants to cover.
- Coverage threshold is 90/85/90/90 across `client/src/**` except `src/index.ts`.
