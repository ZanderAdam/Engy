# Container Management (Daemon Side)

Owns container lifecycle for two backends: devcontainer (local Docker) and Coder (remote workspaces). Also generates `devcontainer.json`/`Dockerfile` from a `ContainerConfig`. See `../../CLAUDE.md` for daemon overview.

## Files

- `manager.ts` — `ContainerManager`: `up()` / `down()` / `status()` / `exec()` for local devcontainer.
- `coder-manager.ts` — `CoderManager`: `up()` / `status()` / `exec()` for Coder cloud workspaces over `coder ssh`.
- `config-generator.ts` — Pure helpers that produce `devcontainer.json` and supporting files in a workspace's `docsDir`.

Handles WS requests: `CONTAINER_UP/DOWN/STATUS_*`, `CONTAINER_PROGRESS_EVENT`, `DEVCONTAINER_CONFIG_GENERATE_*` (dispatched from `../ws/client.ts`).

## Devcontainer (`manager.ts`)

- `up()` shells `devcontainer up --workspace-folder <path>`, parses **stdout** as JSON (`{ outcome, containerId, message }`). Build progress streams from **stderr**, one line at a time, via the optional `onProgress` callback — that callback is what backs `CONTAINER_PROGRESS_EVENT` frames.
- `status()` uses a read-only `docker ps -a --filter label=devcontainer.local_folder=<path>` probe — never starts a container. Returns `running: true` if **any** matching line's status starts with `up` (handles the case where a stopped orphan and a running container both match the label). Any failure is treated as "not running" (try/catch returns `{ running: false }`).
- `down()` has no native `devcontainer` equivalent; we resolve the containerId via `status()` and `docker stop` it. If status reports nothing, `down()` is a no-op.
- `exec()` returns a `ChildProcess` (not a promise) so callers stream — used by both the terminal manager and the agent spawner. Env vars become `--remote-env KEY=VAL` flags.

## Coder (`coder-manager.ts`)

- `up()` runs `coder start <workspace> --yes`; both stdout and stderr are streamed to `onProgress` because Coder writes status to either.
- **`coder ssh` quirk**: it concatenates and re-parses args through the remote shell (not exec). Any unquoted JSON, space, or shell metachar gets mangled. `shellQuote()` wraps each arg in single quotes with `'\''` escaping for embedded quotes, and preserves a leading `~/` outside the quotes so tilde expansion still happens. **Always use `shellQuote()` when building remote commands** — don't pass raw strings.
- `exec()` for Coder also allocates a PTY, which has implications for the agent spawner (see `../runner/CLAUDE.md`).

## Config generator (`config-generator.ts`)

- `devcontainerJsonContent({ docsDir, repos, containerConfig })` produces the JSON; `docsDir` is the workspace root for the container, repos are bind-mounted.
- Repo mounts are **deduped** and any repo equal to or under `docsDir` is dropped (would conflict with the workspace bind).
- Two fixed mounts always added: `~/.claude` → `/home/node/.claude` (host Claude config), `~/.claude.json` → `/tmp/host-claude.json` (read-only).
- `rewriteLocalhostUrls()` rewrites `http(s)://localhost:port/...` env vars to `host.docker.internal:port` so services inside the container can reach the host. `extractHostPorts()` returns the unique sorted set of those ports so the caller can wire `forwardPorts`.
- These helpers are **pure** — keep them that way. File-writing belongs in the caller.

## Adding a backend

If you add a third execution backend:
1. Mirror the `ContainerManager` surface (`up`, `down`, `status`, `exec`) so `runner/agent-spawner.ts` can switch on it uniformly.
2. Pipe progress lines to the existing `CONTAINER_PROGRESS_EVENT` channel — don't invent a new event.
3. Decide on the security stance for `--dangerously-skip-permissions`. Container/coder are considered isolated (see `validateConfig` in `../runner/agent-spawner.ts` and the `DANGEROUS_FLAG_RE` guard in `../terminal/manager.ts`); a new backend must explicitly opt in by being treated as isolated, or stay blocked.

## Tests

- `node:child_process` is mocked. Assert on the **exact argv** passed to `spawn`/`execFile` — the args are the contract with the external CLI and silently breaking them is the most likely regression.
- Cover the JSON-parse failure path for `devcontainer up` (CLI version drift produces non-JSON output occasionally).
- For Coder: cover `shellQuote()` with embedded single quotes, tildes, spaces, and JSON payloads.
