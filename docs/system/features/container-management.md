---
description: Devcontainer and Coder workspace lifecycle — start, stop, status, exec, and config generation.
order: 8
---

# Container Management

Container management provides two backend implementations — `ContainerManager`
(local Docker via the `devcontainer` CLI) and `CoderManager` (remote Coder
cloud workspaces via the `coder` CLI) — plus a pure config-generation layer
that scaffolds the `.devcontainer` directory for a workspace. All three live
under `client/src/container/`.

The daemon receives `CONTAINER_UP/DOWN/STATUS_*` and
`DEVCONTAINER_CONFIG_GENERATE_*` WebSocket requests (dispatched from
`client/src/ws/client.ts`) and delegates to the managers described below.
Agent process spawning inside a container is owned by the execution-engine
area; the workspace `containerEnabled` toggle is owned by workspace-management.

## Devcontainer backend (`client/src/container/manager.ts`)

`ContainerManager.up(workspaceFolder, onProgress?)` spawns
`devcontainer up --workspace-folder <path>`, accumulates stdout, and on
process close parses the output as JSON (`{ outcome, containerId, message }`).
Build progress lines arrive on stderr and are forwarded one trimmed line at a
time to the optional `onProgress` callback without buffering. A `settled` flag
ensures that if both `error` and `close` events fire, only the first is acted
on.

`ContainerManager.status(workspaceFolder)` runs a read-only
`docker ps -a --filter label=devcontainer.local_folder=<path>` probe and
returns `{ running: true, containerId }` if any matching line's status column
starts with `up` (case-insensitive). Docker errors are swallowed and treated as
`{ running: false }`.

`ContainerManager.down(workspaceFolder)` resolves the container id via
`status()` first; if the container is running it calls `docker stop
<containerId>`, otherwise it returns immediately without invoking any Docker
command.

`ContainerManager.exec(workspaceFolder, command, args, env?)` returns a
`ChildProcess` (not a Promise) so callers can stream I/O. Each env entry
becomes a `--remote-env KEY=VAL` flag placed before the command and args.

## Coder backend (`client/src/container/coder-manager.ts`)

`CoderManager.up(workspace, onProgress?)` runs `coder start <workspace>
--yes`. Both stdout and stderr are forwarded to `onProgress` because Coder
writes progress to either stream. A non-zero exit rejects with
`"coder start failed (exit N): <first 500 chars of stderr>"`.

`CoderManager.exec(workspace, command, args, env?, serverPort?)` builds a
`coder ssh --no-wait` command. The key behaviour here is shell-quoting: `coder
ssh` concatenates arguments and re-parses them through the remote shell rather
than exec, so every argument is wrapped by `shellQuote()` in single quotes with
`'\''` for embedded single quotes. A leading `~/` is kept outside the quotes so
the remote shell still performs tilde expansion. If `serverPort` is provided, a
`-R <port>:localhost:<port>` reverse-forwarding flag is added so the in-container
process can reach the Engy server. If `env` is provided, each entry is injected
as a `-e KEY=VAL` flag placed after the optional port-forwarding flag and before
the workspace name.

`CoderManager.execCapture(workspace, command, args)` is the await-and-capture
variant — it uses `execFileAsync` (no PTY, no port forwarding), awaits the
process to completion, and returns `{ stdout, stderr }` for short-lived probe
commands.

`CoderManager.status(workspace)` runs `coder show <workspace> --output json`
and traverses `latest_build.resources[*].agents[*]` looking for
`status === "connected"`. Any parse or exec error returns `{ running: false }`.

`CoderManager.down(workspace)` checks `status()` first and runs
`coder stop <workspace>` only when the workspace is running; it is a no-op
otherwise.

## Config generator (`client/src/container/config-generator.ts`)

`generateDevcontainerConfig(options)` is the entry point: it checks for an
existing `.devcontainer` directory via `fs.access` and returns immediately if
found (idempotent). Otherwise it creates the directory and writes three files:
`devcontainer.json`, `Dockerfile`, and `init-firewall.sh`.

`devcontainerJsonContent({ docsDir, repos, containerConfig })` produces the
JSON object. Repo bind-mounts are deduplicated and any repo path equal to or
under `docsDir` is excluded (it would conflict with the workspace bind-mount).
Two fixed mounts are always appended: `~/.claude` → `/home/node/.claude` and
`~/.claude.json` → `/tmp/host-claude.json` (read-only). User env vars from
`containerConfig.envVars` are merged on top of default env (`NODE_OPTIONS`,
`DEVCONTAINER`) after passing through `rewriteLocalhostUrls`. The
`postStartCommand` rewrites the host `.claude.json` for `host.docker.internal`
and runs the firewall init script; `waitFor: "postStartCommand"` ensures the
container is not considered ready until that script completes.

`rewriteLocalhostUrls(envVars)` replaces `http(s)://localhost:<port>...` with
`http(s)://host.docker.internal:<port>...` so in-container processes can reach
the host. Non-localhost and non-URL values pass through unchanged.

`extractHostPorts(envVars)` returns the unique sorted set of port numbers found
in localhost URLs so `firewallScriptContent` can open iptables rules for those
ports.

`firewallScriptContent(allowedDomains?, hostPorts?)` emits a bash script that
flushes iptables, creates an `allowed-domains` ipset (idempotent `-exist`
flag), resolves GitHub IP ranges and listed domains, sets default DROP policies,
and locks down IPv6. When `hostPorts` is non-empty the script adds an IPv4
`HOST_PORTS` block (between the host-network ESTABLISHED rule and the DROP
policies) and per-port IPv6 `ip6tables` ACCEPT rules. The script runs a
self-test after applying rules and fails if `example.com` is reachable or
`api.github.com` is not.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-CONTAINER-010 | WHEN `ContainerManager.up()` is called and the `devcontainer` process exits with code 0 and `outcome === "success"`, the system SHALL resolve with `{ containerId }` parsed from the JSON stdout. |
| FR-CONTAINER-020 | WHILE `ContainerManager.up()` is running, the system SHALL forward each non-empty right-trimmed (trailing-whitespace-trimmed) stderr line to the caller-supplied `onProgress` callback without buffering. |
| FR-CONTAINER-030 | IF the `devcontainer` process exits with a non-zero code or `outcome !== "success"`, THEN the system SHALL reject with the `message` field from the JSON result, or with the fallback string `"devcontainer up failed"` if no message is present. |
| FR-CONTAINER-040 | IF `devcontainer` emits non-JSON stdout, THEN the system SHALL reject with an error message beginning `"Failed to parse devcontainer output:"` containing the first 200 characters of stdout. |
| FR-CONTAINER-050 | WHEN `ContainerManager.status()` is called, the system SHALL probe container state using a read-only `docker ps -a` command filtered by the `devcontainer.local_folder` label and SHALL return `{ running: true, containerId }` if any matching row's status starts with `"up"` (case-insensitive), or `{ running: false }` otherwise including on docker errors. |
| FR-CONTAINER-060 | WHEN `ContainerManager.down()` is called and `status()` reports the container is running, the system SHALL stop it via `docker stop <containerId>`; if the container is not running the system SHALL return without issuing any additional command. |
| FR-CONTAINER-070 | WHEN `ContainerManager.exec()` is called, the system SHALL return a `ChildProcess` synchronously with env entries passed as `--remote-env KEY=VAL` flags before the command and its args. |
| FR-CONTAINER-080 | WHEN `CoderManager.up()` is called and `coder start` exits with a non-zero code, the system SHALL reject with `"coder start failed (exit N): <first 500 chars of stderr>"`. |
| FR-CONTAINER-090 | WHEN `CoderManager.exec()` is called, the system SHALL shell-quote every command and argument by wrapping them in single quotes with `'\''` for embedded single quotes, preserving a leading `~/` outside the quotes; WHERE `serverPort` is provided, the system SHALL prepend a `-R <port>:localhost:<port>` reverse-forwarding flag to the `coder ssh` arguments; WHERE `env` is provided, the system SHALL inject each entry as a `-e KEY=VAL` flag after any port-forwarding flag and before the workspace name. |
| FR-CONTAINER-100 | WHEN `CoderManager.status()` is called, the system SHALL run `coder show <workspace> --output json` and return `{ running: true }` if any agent under `latest_build.resources[*].agents` has `status === "connected"`, or `{ running: false }` on any other outcome including parse and exec errors. |
| FR-CONTAINER-110 | WHEN `generateDevcontainerConfig()` is called and the `.devcontainer` directory already exists, the system SHALL return immediately without writing any files. |
| FR-CONTAINER-120 | WHEN `devcontainerJsonContent()` is called, the system SHALL exclude from bind-mounts any repo path equal to or under `docsDir` and SHALL deduplicate the remaining repo paths so each appears at most once. |
| FR-CONTAINER-130 | WHEN `devcontainerJsonContent()` is called with `containerConfig.envVars`, the system SHALL rewrite `http(s)://localhost:<port>` values to `host.docker.internal:<port>` and SHALL merge the rewritten vars on top of the default container environment. |
| FR-CONTAINER-140 | WHEN `firewallScriptContent()` is called with `hostPorts`, the system SHALL emit an IPv4 `HOST_PORTS` iptables block placed after the host-network ESTABLISHED rule and before the default DROP policies, and SHALL emit per-port IPv6 ACCEPT rules for `host.docker.internal`; WHERE no `hostPorts` are given, both blocks SHALL be omitted while the IPv6 lockdown block is always emitted. |

## Sources

No prior knowledge found.
