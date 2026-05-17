# Runner (Agent Process Spawner)

Spawns Claude Code CLI processes per agent session, in one of four execution modes (host / container / coder / remote). Manages a per-session git worktree so each agent has an isolated branch. See `../../CLAUDE.md` for daemon overview.

## Files

- `index.ts` — `Runner`: orchestrates session lifecycle (worktree create → spawn → emit events → cleanup). Wires `AgentSpawner` to the WS send function.
- `agent-spawner.ts` — `AgentSpawner`: builds the `claude` argv, picks a `spawn` strategy (host / container exec / coder ssh exec), waits for exit, extracts the structured-output JSON.

Handles WS requests: `EXECUTION_START_REQUEST`, `EXECUTION_STOP_REQUEST`. Emits: `EXECUTION_STATUS_EVENT` (with `worktreePath`), `EXECUTION_COMPLETE_EVENT` (with `exitCode`, `success`, `completionSummary`).

## Execution modes

| Mode | Cwd | Worktree | stdin for prompt | Container/coder backend |
|---|---|---|---|---|
| **host** | local worktree | `git worktree add` locally via `simple-git` | piped to stdin | none |
| **container** | container's `--workspace-folder` | local worktree (mounted in) | piped to stdin | `ContainerManager.exec` |
| **coder** | remote `coderRepoBasePath/<repo>/.claude/worktrees/...` | `coder ssh -- git worktree add` (POSIX paths via `path.posix.join`) | **CLI arg, not stdin** (coder PTY echoes stdin) | `CoderManager.exec` |
| **remote** | provided `repoPath` (cloud clones) | none — `--remote` flag handles it | CLI arg (`--remote <prompt>`) | `spawn('claude', ...)` with `stdio: 'inherit'` |

Worktree dir is `.claude/worktrees/engy-session-<shortId>` with branch `engy/session-<shortId>`, both branched from `main`.

## Resume mode

`config.existingWorktreePath` reuses an existing session's worktree so `claude --resume` can locate its JSONL under `~/.claude/projects/<encoded-cwd>/`. Don't create a new worktree in this branch — the cwd path is part of how Claude finds its history.

## Building argv (`agent-spawner.ts` `buildArgs`)

- Always: `-p --output-format json --json-schema <TASK_COMPLETION_SCHEMA>`. The schema forces Claude to emit `{ taskCompleted, summary }` as structured output.
- Permission flag: `--dangerously-skip-permissions` inside container/coder (isolated); `--permission-mode acceptEdits` on host.
- Session identity is mutually exclusive: `--session-id <sessionId>` for new sessions, `--resume <sessionId>` for resumed ones (caller-supplied `--resume` flag also counts). Setting both is a CLI error.
- Container/coder modes append `--add-dir <workingDir>` because the worktree isn't the cwd.
- Coder mode: prompt is the **first positional arg**, before flags — variadic flags like `--add-dir <directories...>` would otherwise slurp it.
- Remote mode: argv is just `['--remote', prompt]` — no JSON output, no schema, no session id.

## stdout parsing

Claude's `--output-format json` emits one JSON line. Use `extractJsonOutput(stdout)`:
1. Try `JSON.parse(stdout)` first.
2. Fall back to finding a line that starts with `{` and ends with `}` (coder mode wraps in a PTY that appends terminal escape sequences after the JSON).
3. Returns `null` on both failures — caller treats as no completion.

## Security guard

`validateConfig()` rejects `--dangerously-skip-permissions` on host (must be isolated: `containerMode` or `coderWorkspace` set). Remote mode skips local validation entirely (cloud enforces). This mirrors the terminal manager's `DANGEROUS_FLAG_RE` guard — keep the two in sync.

## Lifecycle & timeouts

- `Runner.start()` is fire-and-forget — the `spawner.spawn(...)` promise chain emits the complete event itself. Don't `await` it from the WS handler.
- `Runner.stop()` sends `SIGTERM`, schedules `SIGKILL` after 5s grace (timer is `.unref()`ed so it doesn't keep the process alive). Emits a synthetic `complete` event with `success: false` immediately — don't wait for the real exit.
- Default timeout is 30 minutes (`DEFAULT_TIMEOUT_MS`). Configurable per `SpawnConfig.timeoutMs`.
- One process at a time per `AgentSpawner` instance (`currentProcess`). Multiple concurrent sessions need multiple spawners.

## Tests

- `node:child_process` mocked. Assert on the exact argv — it's the contract with `claude`.
- Worktree creation uses real `simple-git` against a temp repo for host mode; coder mode mocks the `execFileAsync('coder', ...)` call and asserts the remote command shape (POSIX paths, no double slashes).
- Cover the JSON parse fallback (raw JSON, JSON with trailing escapes, no JSON at all).
- Cover the security guard: `--dangerously-skip-permissions` on host → throws; same flag in container/coder → passes through.
