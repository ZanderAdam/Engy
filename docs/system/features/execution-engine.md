---
title: Execution Engine
order: 6
description: Agent session lifecycle — start, stop, retry, feedback, completion handling, spawn modes, auto-start, and remote execution.
---

# Execution Engine

The execution engine orchestrates every AI agent session from trigger to
completion. It spans two packages: the server-side
`executionRouter` (`web/src/server/trpc/routers/execution.ts`) handles session
bookkeeping, prompt construction, dispatch, and auto-start policy; the
client-side `Runner` and `AgentSpawner`
(`client/src/runner/index.ts`, `client/src/runner/agent-spawner.ts`) receive
`EXECUTION_START_REQUEST` over the daemon WebSocket, create an isolated git
worktree, spawn the Claude Code CLI, and emit `EXECUTION_STATUS_EVENT` /
`EXECUTION_COMPLETE_EVENT` back to the server.

## Key components

| File | Role |
|---|---|
| `web/src/server/trpc/routers/execution.ts` | tRPC procedures: `startExecution`, `stopExecution`, `retryExecution`, `sendFeedback`, `getSessionFile`, `getActiveSessions`, `getSessionStatus`, `startBatchExecution`, `pushRemoteFile`, `getWorktreeSessions` |
| `web/src/server/ws/server.ts` | `handleExecutionCompleteEvent` — processes `EXECUTION_COMPLETE_EVENT` from daemon; idempotency guard + all completion branches |
| `client/src/runner/index.ts` | `Runner` — worktree lifecycle, WS event emission, stop/retry coordination |
| `client/src/runner/agent-spawner.ts` | `AgentSpawner` — argv construction, process spawn strategy, stdout parsing, timeout |
| `web/src/server/db/schema.ts` | `agentSessions` table (`sessionId`, `status`, `executionMode`, `taskId`, `taskGroupId`, `worktreePath`, `completionSummary`) |
| `web/src/lib/shell.ts` | `buildContextBlock`, `buildQuickActionDirs` — system-prompt and `--add-dir` construction |

## Session lifecycle

`startExecution` resolves the scope (`task` / `planning` / `taskGroup` /
`milestone`), builds a prompt and system-prompt string, inserts an
`agentSessions` row with `status: 'active'`, optionally moves the task to
`in_progress`, and dispatches `EXECUTION_START_REQUEST` to the daemon.  If the
dispatch fails the session is immediately set to `stopped` and the task is
reverted and marked `subStatus: 'failed'`.

On the daemon side, `Runner.start` creates a git worktree branched from `main`
(local via `simple-git`, remote via `coder ssh -- git worktree add`, or none
for remote sessions), emits `EXECUTION_STATUS_EVENT` with the `worktreePath`,
then fires the `AgentSpawner.spawn` promise chain.  The spawner builds the
`claude` argv (always `-p --output-format json --json-schema <schema>`), writes
the prompt to stdin (host / container mode) or passes it as the first
positional arg (coder mode), and waits for process exit.

`handleExecutionCompleteEvent` (server, `ws/server.ts`) processes the
`EXECUTION_COMPLETE_EVENT`.  It branches on task-blocked state, planning mode,
and remote-session status before updating `agentSessions` and `tasks`, and
dispatching async post-completion actions (Coder remote file pull, worktree
merge).

## Prompt construction

For `task` scope the system prompt is produced by `buildContextBlock` and
carries workspace slug, project slug, repo paths, `autoAgentCompletion` mode,
`earsBdd` flag, and the live session id.  The main prompt is
`Use <implementSkill> for <ws-slug>-T<id>`.  All additional dirs from
`buildQuickActionDirs` are passed as `--add-dir` flags.  Planning scope uses
`buildPromptForPlan` (planSkill + same context block); taskGroup and milestone
scopes have their own builders.

The agent-worktree instruction rides the prompt
(`withAgentWorktreeInstruction`), gated by `shouldRequestAgentWorktree`, rather
than the context block: the system prompt reaches every subagent the dispatched
agent spawns, which would ask each of them for a worktree of its own.
Background executions never get it — the daemon runner already creates the
worktree they run in.

Remote sessions receive a plain-text prompt built by `buildRemotePrompt`
(workspace context, task title/description, plan file content if present) and
an empty flags array — no system-prompt injection, no `--add-dir`.

## Resume and feedback

`retryExecution` reuses the existing `agentSessions` row (same `sessionId`) so
the UI keeps polling the same JSONL file.  `buildResumeConfig` re-derives the
`ExecutionStartConfig` from the task, using the original `worktreePath` so
`claude --resume` locates its JSONL under
`~/.claude/projects/<encoded-cwd>/`.  `buildResumeFlags` re-emits the
`--append-system-prompt` and `--add-dir` flags of the original run.  The
dispatch appends `--resume <sessionId>` after those flags.

`sendFeedback` writes the feedback text to `tasks.feedback`, rebuilds the
resume flags with a feedback wrapper prompt, and dispatches
`EXECUTION_START_REQUEST` with `--resume`; on success it clears `feedback` and
sets `subStatus: 'implementing'`.

## Spawn modes

| Mode | Worktree creation | Prompt delivery | Permission flag |
|---|---|---|---|
| host | `simple-git` local `worktree add` | piped to stdin | `--permission-mode acceptEdits` |
| container | `simple-git` local; worktree mounted | piped to stdin | `--dangerously-skip-permissions` |
| coder | `coder ssh -- git worktree add` (POSIX paths via `path.posix.join`) | first positional arg before flags | `--dangerously-skip-permissions` |
| remote | none — `--remote <prompt>` argv, `stdio: inherit` | CLI arg | none (cloud enforced) |

The security guard in `validateConfig` rejects
`--dangerously-skip-permissions` unless the session is isolated
(`containerMode` or `coderWorkspace` set); remote mode skips local validation
entirely.

## Auto-start

`triggerAutoStart` is called after task creation when `workspace.autoStart` is
true.  It silently skips if no daemon is connected, if the task belongs to a
task group or milestone, or if the active session count for the workspace meets
`maxConcurrency` (excluding sessions not updated in 24 h).  It selects
`scope: 'planning'` when `task.needsPlan && !planFileOnDisk`, otherwise
`scope: 'task'`.  Any error from `startExecution` is caught, `subStatus` is
set to `'failed'`, and a task broadcast is fired — no re-throw.

## Requirements

Functional requirements in EARS notation. These are the single source of truth
for the execution engine's behaviour. Tag the verifying tests with the FR id in
their title string, e.g. `it('[FR-EXECUTION-010] ...', ...)`, and run
`trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-EXECUTION-010 | WHEN `startExecution` is called with `scope:'task'` and a daemon is connected, the system SHALL insert an `agentSessions` row with `status:'active'`, `executionMode:'task'`, and the resolved `taskId`, and SHALL move the task to `status:'in_progress'`, `subStatus:'implementing'` before dispatching `EXECUTION_START_REQUEST`. |
| FR-EXECUTION-020 | WHEN `startExecution` builds a local (non-remote) task-scope session, the system SHALL include `--append-system-prompt` containing the workspace slug, project slug, repo paths, `autoAgentCompletion` mode, `earsBdd` flag, and session id, and SHALL append one `--add-dir` flag per additional dir from `buildQuickActionDirs`. |
| FR-EXECUTION-030 | WHEN `startExecution` is called with `scope:'planning'`, the system SHALL insert an `agentSessions` row with `executionMode:'planning'`, move the task to `subStatus:'planning'`, and dispatch `EXECUTION_START_REQUEST` with a prompt constructed from `planSkill` (defaulting to `/engy:plan`). |
| FR-EXECUTION-040 | WHEN `startExecution` is called with `scope:'taskGroup'`, the system SHALL insert an `agentSessions` row with `executionMode:'group'` and the resolved `taskGroupId`, and SHALL dispatch `EXECUTION_START_REQUEST` with a prompt containing the task group name and `implementSkill`. |
| FR-EXECUTION-050 | WHEN `startExecution` is called with `scope:'milestone'`, the system SHALL insert an `agentSessions` row with `executionMode:'milestone'` linked to the first task in the milestone, and SHALL dispatch `EXECUTION_START_REQUEST` with a prompt using `/engy:implement-milestone` and the milestone ref. |
| FR-EXECUTION-060 | IF an `agentSessions` row with `status` `'active'` or `'submitted'` updated within the last 24 hours already exists for the same scope target, THEN the system SHALL throw a `CONFLICT` error with message `'An execution is already active for this scope'` and perform no DB write. |
| FR-EXECUTION-070 | IF `startExecution` is called when no daemon WebSocket is connected, THEN the system SHALL throw with message `'No daemon connected'` before any DB write. |
| FR-EXECUTION-080 | IF the `EXECUTION_START_REQUEST` dispatch is rejected by the daemon, THEN the system SHALL set the `agentSessions` row to `status:'stopped'` with the error message as `completionSummary`, revert the task to its previous `status` and `subStatus:'failed'`, and broadcast the task change. |
| FR-EXECUTION-090 | WHEN `startExecution` is called with `remote:true`, the system SHALL pre-mark the session `status:'submitted'` before dispatching, SHALL pass an empty flags array in `EXECUTION_START_REQUEST`, and SHALL NOT update the task status upon receiving `EXECUTION_COMPLETE_EVENT`. |
| FR-EXECUTION-100 | IF `startExecution` is called with `remote:true` and the workspace has no configured repositories, THEN the system SHALL throw `BAD_REQUEST` with message `'Remote execution requires at least one repository configured in the workspace'` before any DB write. |
| FR-EXECUTION-110 | WHEN `stopExecution` is called, the system SHALL dispatch `EXECUTION_STOP_REQUEST` to the daemon, set the session to `status:'stopped'`, and the daemon runner SHALL send SIGTERM to the agent process and emit `EXECUTION_COMPLETE_EVENT` with `success:false` immediately — without waiting for the process to exit. |
| FR-EXECUTION-120 | WHILE an agent process has received SIGTERM from a stop or timeout, the system SHALL send SIGKILL to that process after a 5-second grace period. |
| FR-EXECUTION-130 | WHEN `retryExecution` is called for a stopped local session, the system SHALL reuse the existing `agentSessions` row (reset to `status:'active'`, `completionSummary:null`) and SHALL dispatch `EXECUTION_START_REQUEST` with the original `--append-system-prompt` and `--add-dir` flags followed by `--resume <sessionId>`, running from the original `worktreePath`. |
| FR-EXECUTION-140 | IF `retryExecution` or `sendFeedback` is called for a session with `status:'submitted'`, THEN the system SHALL throw `BAD_REQUEST` with a message directing the user to follow up on claude.ai/code. |
| FR-EXECUTION-150 | WHEN `sendFeedback` is called for a non-remote session, the system SHALL write the feedback text to `tasks.feedback`, dispatch `EXECUTION_START_REQUEST` with a resume prompt wrapping the feedback, and on success SHALL clear `tasks.feedback` and set `subStatus:'implementing'`. |
| FR-EXECUTION-160 | WHEN `EXECUTION_COMPLETE_EVENT` arrives with `success:true` for a task-scope session whose task is not blocked, the system SHALL set `agentSessions.status:'completed'` and move the task to `status:'done'`, `subStatus:null`; WHEN `autoAgentCompletion` is `'merge'`, the system SHALL dispatch a worktree merge request asynchronously. |
| FR-EXECUTION-170 | WHEN `EXECUTION_COMPLETE_EVENT` arrives with `success:true` for a planning-scope session, the system SHALL set `agentSessions.status:'completed'` and move the task to `subStatus:'plan_review'`; for Coder workspaces the system SHALL dispatch a `resolveGlob` `REMOTE_FILE_PULL_REQUEST` matching `plans/<ws-slug>-T<id>.plan.md plans/<ws-slug>-T<id>-*.plan.md` and SHALL write the pulled content into the local project under the filename the daemon resolved. |
| FR-EXECUTION-180 | WHEN `EXECUTION_COMPLETE_EVENT` arrives for a session whose task has `subStatus:'blocked'`, the system SHALL set `agentSessions.status:'paused'` and SHALL NOT change the task's `subStatus`. |
| FR-EXECUTION-190 | IF `EXECUTION_COMPLETE_EVENT` arrives for a session already in a terminal state (`completed`, `stopped`, `paused`, or `submitted`), THEN the system SHALL silently ignore the event and perform no DB write. |
| FR-EXECUTION-200 | WHEN a new top-level task (no `taskGroupId`, no `milestoneRef`) is created in a workspace with `autoStart:true` and a daemon is connected, the system SHALL call `triggerAutoStart`, which SHALL dispatch `startExecution` with `scope:'planning'` when `needsPlan` is true and no plan file exists on disk, or `scope:'task'` otherwise; any dispatch error SHALL set `subStatus:'failed'` on the task without re-throwing. |
| FR-EXECUTION-210 | WHILE the count of active `agentSessions` (updated within the last 24 hours, with a non-null `worktreePath`) for the workspace meets or exceeds `workspace.maxConcurrency`, the system SHALL skip `triggerAutoStart` without starting the task. |
| FR-EXECUTION-220 | WHEN an agent process exits with a JSON object containing `structured_output.taskCompleted` and `structured_output.summary`, the system SHALL derive `success` from `taskCompleted` (not from the exit code), and WHEN `memories` is a non-empty array in that object, the system SHALL emit `CREATE_MEMORIES_EVENT` to the server before emitting `EXECUTION_COMPLETE_EVENT`. |
| FR-EXECUTION-230 | IF `AgentSpawner.validateConfig` is called for a non-remote, non-isolated (host) spawn configuration that includes `--dangerously-skip-permissions`, THEN the system SHALL throw before spawning any process. |
| FR-EXECUTION-240 | WHEN spawning in host mode (no container, no coder), the system SHALL create a git worktree locally via `simple-git`, spawn `claude` with `--permission-mode acceptEdits` and `--session-id <sessionId>`, and pipe the prompt to stdin. |
| FR-EXECUTION-250 | WHEN spawning in Coder mode (`coderWorkspace` and `coderRepoBasePath` both set), the system SHALL create the worktree remotely via `coder ssh -- git worktree add` using `path.posix.join` to normalise paths, spawn `claude` via `CoderManager.exec` with `--dangerously-skip-permissions`, and pass the prompt as the first positional argument before all flags. |
| FR-EXECUTION-260 | WHILE an agent process has been running for `DEFAULT_TIMEOUT_MS` (30 minutes) without exiting, the system SHALL send SIGTERM followed by SIGKILL after a 5-second grace period. |
| FR-EXECUTION-270 | IF `Runner.stop` has emitted a synthetic `EXECUTION_COMPLETE_EVENT` for a session and the agent process later exits naturally, THEN the system SHALL suppress the second `EXECUTION_COMPLETE_EVENT` so exactly one event is emitted per session. |
| FR-EXECUTION-280 | WHEN `getSessionFile` is queried for a session id, the system SHALL search `~/.claude/projects/` directories on the local filesystem for a matching `<sessionId>.jsonl` file and return its parsed JSONL entries; IF no local file is found and the session belongs to a Coder workspace, the system SHALL fall back to locating and reading the file via `coder ssh`; IF neither source yields a file, the system SHALL return an empty array. |
| FR-EXECUTION-290 | WHEN `pushRemoteFile` is called for a task in a Coder workspace, the system SHALL dispatch `REMOTE_FILE_PUSH_REQUEST` to the daemon with the plan path resolved server-side from the local `plans/` directory (falling back to `plans/<ws-slug>-T<id>.plan.md` when no plan file exists) and SHALL clear `tasks.needsPlan` only after a successful push; for non-Coder workspaces the system SHALL clear `tasks.needsPlan` without dispatching. |
| FR-EXECUTION-300 | WHEN spawning an agent process in host, container, or Coder mode, the system SHALL set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` in the process environment so CLAUDE.md files from `--add-dir` directories (including the project docs dir) load into context. |
| FR-EXECUTION-310 | WHEN a quick action launches implementation work (task implement, task group, milestone) in a workspace with `agentWorktrees` enabled AND the terminal is not already scoped to a worktree, the system SHALL append an instruction to the agent's **prompt** — not the context block — telling it to create a dedicated git worktree and work inside it; for every other dispatch — including background executions, which the daemon already places in a worktree — the prompt SHALL be unchanged. |

## Sources

No prior knowledge found.
