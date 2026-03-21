---
title: Execution Engine
status: active
---

# Plan: M6 Execution Engine

## Overview

M6 delivers the autonomous execution runtime for Engy v2. A simple runner loop on the client daemon spawns short-lived Claude CLI agents per task, tracks execution state in SQLite, and reads Claude's native session files for execution logs. Dev containers provide optional sandboxed execution with `--dangerously-skip-permissions`. Per-session git worktrees from local main isolate each execution run. A questions system enables agents to ask for clarification during planning, and a feedback loop lets devs kick back implementation results via the diff viewer.

No frameworks. The orchestrator is a for loop and a spawn. SQLite is the state machine.

Boundary: no auto-commit/push/PR (future milestone), no Mastra, no long-running agents, no workflow engine, no cloud sandboxes, no agent-generated memories (future milestone).

## Codebase Context

**What M1-M5 shipped:**

* SQLite schema: workspaces, projects, taskGroups, tasks, taskDependencies, agentSessions, fleetingMemories, projectMemories, comments, commentThreads

* WebSocket protocol: REGISTER, VALIDATE_PATHS, SEARCH_FILES, FILE_CHANGE, GIT_STATUS/DIFF/LOG/SHOW/BRANCH_FILES, terminal relay (spawn/input/resize/kill/reconnect)

* Client daemon: WS client with reconnect, git ops via `simple-git` + `execFile`, file watcher (chokidar), terminal manager (node-pty), session manager with circular buffer

* Server: tRPC API (workspace, project, task, task-group, milestone, comment, dir, diff routers), MCP server (13 tools), WebSocket dispatch with pending maps

* UI: Next.js App Router, shadcn/ui, xterm.js terminal panel, diff viewer, task views (kanban, eisenhower, dependency graph)

**Existing worktree context doc** (`context/worktrees.md`): detailed plan for project-level worktrees. M6 simplifies this to per-session worktrees from local main — no project-level worktrees, no `effectiveWorkspace()`/`effectiveRepos()` helpers, no WS protocol for worktree ops. The runner creates worktrees directly on the client daemon.

**Old Engy3 reference** (`engy3/websocket/src/workflow/executors/`): LlmExecutor spawning `claude -p --output-format json`, ClaudeExecutionManager wrapping prompts with task context + memories + aggregated issues and requiring structured completion output via `--json-schema` (TASK_COMPLETION_SCHEMA: taskCompleted, summary, memories), ValidationRunner for shell + claude-code validations. M6 replaces XState with a plain loop but preserves the structured output pattern.

## Affected Components

| File                                                  | Change                                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/server/db/schema.ts`                         | **Modify** — add subStatus/sessionId/feedback to tasks, worktreePath/completionSummary to agentSessions, container config + maxConcurrency to workspaces (TG1), new questions table |
| `common/src/ws/protocol.ts`                           | **Modify** — add execution commands (start/stop/status/complete), container lifecycle messages (TG1)                                                                                |
| `client/src/runner/index.ts`                          | **Create** — runner loop: worktree lifecycle, pick task, spawn agent, track status, handle questions/feedback, parallel execution                                                   |
| `client/src/runner/agent-spawner.ts`                  | **Create** — spawn `claude -p` or `devcontainer exec ... claude -p`, structured completion via `--json-schema`                                                                      |
| `client/src/container/manager.ts`                     | **Modify** (TG1 done) — @devcontainers/cli integration (up/exec/down)                                                                                                               |
| `client/src/ws/client.ts`                             | **Modify** — handle execution and container WS commands                                                                                                                             |
| `web/src/server/trpc/routers/execution.ts`            | **Create** — start/stop/retry execution, session file reading, execution status                                                                                                     |
| `web/src/server/trpc/routers/question.ts`             | **Create** — questions CRUD, batch answer submission                                                                                                                                |
| `web/src/server/trpc/routers/task.ts`                 | **Modify** — add subStatus to task updates                                                                                                                                          |
| `web/src/server/trpc/routers/diff.ts`                 | **Modify** — resolve session worktree path, pass as repoDir for worktree-scoped diffs                                                                                               |
| `web/src/server/mcp/index.ts`                         | **Modify** — add askQuestion tool, expose execution data in getProjectDetails                                                                                                       |
| `web/src/server/ws/server.ts`                         | **Modify** — dispatch execution commands, handle status/complete events                                                                                                             |
| `web/src/server/trpc/context.ts`                      | **Modify** — add pending maps for execution WS operations                                                                                                                           |
| `web/src/components/tasks/execution-tab.tsx`          | **Create** — session file viewer in task detail (reads Claude JSONL session files)                                                                                                  |
| `web/src/components/tasks/task-card.tsx`              | **Modify** — auto-implement icon/badge for subStatus                                                                                                                                |
| `web/src/components/questions/question-list.tsx`      | **Create** — notification-triggered question list grouped by task/session                                                                                                           |
| `web/src/components/questions/question-dialog.tsx`    | **Create** — per-task/session question dialog with structured options                                                                                                               |
| `web/src/components/diff/review-actions.tsx`          | **Modify** — add task-record feedback path for runner agents                                                                                                                        |
| `web/src/components/workspace/container-settings.tsx` | **Modify** (TG1 done) — container config in workspace settings                                                                                                                      |

## Functional Requirements

### Git Worktrees

1. The system shall create **per-session worktrees** from local main when execution starts. Path: `{repo}/.claude/worktrees/{session-branch}`. The runner creates worktrees directly (no WS protocol needed — runner runs on the client daemon). *(source: user request, simplified from context/worktrees.md)*

2. The system shall store `worktreePath` on the `agentSessions` table. The diff viewer and execution UI use this to locate diffs and session files. *(source: user request)*

3. The system shall **retain** worktrees after a session completes — worktrees are needed for diff review, feedback loops, and eventually PR creation (future milestone). Cleanup is deferred to the PR/merge milestone where worktrees are removed after the PR is merged. *(source: inferred — worktree lifecycle spans beyond execution)*

4. For task groups, all tasks share one worktree/session. For individual tasks, each gets its own ephemeral worktree. *(source: user request)*

### Dev Containers

8. The system shall support optional per-workspace Docker containers enabled via workspace settings (`containerEnabled`, `allowedDomains`, `extraPackages`, `envVars`, `idleTimeout`). *(source: v2 architecture)*

9. The system shall manage **one container per workspace** via `@devcontainers/cli`: `devcontainer up` on first use (or when task group starts), `devcontainer exec` for running agents, tear down after configurable idle timeout when idle. **Idle** = no running task agents AND no connected container terminals (no processes currently executing against the dev container). Shared across all task groups in the workspace. *(source: v2 architecture + elicited)*

10. The system shall provide a base `.devcontainer/devcontainer.json` in the **workspace docsDir** using Anthropic's reference config (`ghcr.io/anthropics/devcontainer-features/claude-code:1`), with network firewall (default-deny, whitelist npm/GitHub/Claude API + workspace additions). All workspace repos **and project dirs** (any `--add-dir` paths passed to claude) are bind-mounted into the container. Host `~/.claude` directory is bind-mounted for OAuth tokens, global config, and state data persistence. See `context/anthropic-devcontainer-reference.md` for exact Anthropic reference files (devcontainer.json, Dockerfile, init-firewall.sh) and Engy adaptation notes. *(source: v2 architecture + elicited)*

10a. The system shall rewrite `localhost` URLs to `host.docker.internal` equivalents in container environment variables. Following the pattern from Anthropic's reference config (which allows host network access via `HOST_NETWORK` in the firewall), any host-local URLs (e.g., `ENGY_SERVER_URL=http://localhost:3000`) must be rewritten to `http://host.docker.internal:3000` when passed as `containerEnv` or `remoteEnv` to `devcontainer exec`. This ensures MCP server connections, API endpoints, and other localhost services remain reachable from inside the container. *(source: Anthropic reference config host network pattern + user request)*

11. The system shall fall back to direct host execution when containers are disabled. *(source: v2 architecture)*

12. The system shall support opening a full xterm terminal into a running container with the same persistence, reconnect, and circular buffer capabilities as local terminals. Container terminals use `devcontainer exec --workspace-folder {path} /bin/bash` instead of local `pty.spawn`, but all xterm features (resize, kill, reconnect with buffer replay) remain. *(source: user request — same terminal experience in containers)*

13. When containers are enabled, **ALL Claude-related execution runs in containers** — not just orchestrated agent spawns. This includes: (a) runner-spawned task agents, (b) one-off task execution from the UI, (c) all terminals opened from the terminal panel on the right side of the UI, (d) background processes spawned by Claude. Any xterm session or Claude invocation, whether initiated by the runner or manually via the UI, must route through `devcontainer exec` when `containerEnabled=true` on the workspace. *(source: v2 architecture + user request)*

14. **Hard validation**: The system shall NEVER allow `--dangerously-skip-permissions` to be used outside of a container. The agent spawner must validate that this flag is only passed when executing via `devcontainer exec`. If containerEnabled is false on the workspace, the flag must not be used regardless of any other configuration. *(source: user request — safety critical)*

### Runner

15. The system shall provide an "Execute in Background" action in the quick action dropdowns for tasks, task groups, and milestones. This triggers headless execution via the runner instead of opening a terminal. The action shall be available alongside the existing "Implement" terminal action. When a session is active, the quick action button shows a running/completed status indicator. *(source: user request)*

16. The system shall provide a runner on the client daemon that: creates a worktree from local main, spawns an agent with the same prompt and flags that existing quick actions build, waits for exit, reports status. The agent itself handles task orchestration — the runner is just a headless version of clicking "Implement" in the UI. *(source: v2 architecture, simplified — agent is the orchestrator)*

17. The runner shall receive start/stop commands from the server via WebSocket. The server sends `EXECUTION_START_REQUEST` with the pre-built prompt and flags (same as quick actions: `--append-system-prompt` with project context, `--add-dir` for repos). The runner creates a worktree, spawns the agent, and reports back. *(source: inferred + elicited)*

18. The system shall track `sessionId` on the session record. The system generates its own UUID for `--session-id` before spawning. *(source: user request)*

19. The runner shall emit execution status events to the server via WebSocket (session started, session completed/failed). Execution output is NOT streamed — Claude writes session files to `~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`, readable from host via bind mount. *(source: inferred, simplified)*

### Agent Spawning

20. The system shall spawn agents via `claude -p --output-format stream-json --permission-mode acceptEdits` on host, or `devcontainer exec ... claude -p --output-format stream-json --dangerously-skip-permissions` in containers. The spawner enforces FR #14 (hard validation of permission flags). *(source: v2 architecture + user confirmation)*

21. The system shall write the quick-action-built prompt to stdin and close it. *(source: engy3 reference)*

22. The system shall support session management via `--session-id {uuid}` (new session) and `--resume {sessionId}` (retry/feedback continuation). *(source: v2 architecture)*

23. The system shall require structured completion output via `--json-schema` with a task completion schema: `{ taskCompleted: boolean, summary: string }`. *(source: engy3 reference)*

24. Execution output is stored in Claude's native session files (`~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`). The UI reads these directly — no SQLite storage. *(source: engy3 reference, simplified)*

25. The system shall support **manual retry only** — failed sessions stay failed until user clicks "Retry". *(source: elicited)*

26. The system shall support **auto-start** as an opt-in per-workspace setting. When a task's type changes to `ai`, starts a runner if none is running. *(source: spec FR-9.7, adapted)*

### Questions System

27. The system shall provide an `askQuestion` MCP tool modeled after Claude Code's native `AskUserQuestion` tool. The tool accepts `{ sessionId, taskId?, documentPath?, questions: [{ question, header, multiSelect, options: [{ label, description, preview? }] }] }` — supporting 1-4 batched questions per call, structured options with descriptions, optional markdown previews for visual comparison, and multi-select. `sessionId` (required) identifies the agent session asking; `taskId` (optional) identifies the task being planned; `documentPath` (optional) references the spec/plan doc the agent is reading. The tool writes each question as a separate row to SQLite (persisted for durability across page refreshes). Signals the agent to exit. *(source: v2 architecture + user request to model after Claude Code AskUserQuestion tool)*

28. The system shall surface unanswered questions via a **persistent notification badge** in the header (count of unanswered questions). The notification persists until **all** questions in the group (task or session) are answered and submitted — partially answered groups still show in the badge count. Clicking the notification opens a **question list** with two grouping modes: (a) **task-scoped questions** grouped by task — each entry shows task title and unanswered count; (b) **session-scoped questions** (no task) — each session is its own entry showing the session ID or a label. Clicking any entry opens a **question dialog** with tabs: one **tab per question** (labeled by `header` chip, e.g. "Auth", "ORM") — each tab shows the question text, structured options (label + description), optional preview rendered as HTML via markdown, multi-select support via checkboxes, free-text "Other" input. A **Task** tab (only when `taskId` is set) — task title and description. A **Document** tab (when `documentPath` is set) — reuses the existing document editor in read-only mode. Single "Submit All" button in the dialog footer. Questions are persisted in the database and survive page refresh. The runner is only notified after the user submits all answers for a group — partial submissions do not unblock the task or resume the agent. *(source: v2 architecture + user request on persistent notifications until fully answered)*

29. When all questions are answered in the UI, the runner spawns a new agent invocation with `--resume {sessionId}` and answers as context. *(source: v2 architecture)*

30. When `taskId` is provided, the `askQuestion` MCP tool validates server-side that the task's `subStatus === 'planning'` and rejects otherwise. When `taskId` is omitted (session-scoped), no validation. *(source: v2 architecture — relaxed for non-task agents)*

### Feedback Loop

31. The diff viewer shall scope diffs to session worktree paths. The **server** looks up `worktreePath` from the session record and passes it as `repoDir` to existing git diff operations. The diff viewer shall include a **session selector dropdown** listing active and recent sessions. *(source: user request)*

32. The diff viewer shall provide a "Send Feedback" action that writes feedback text to the task record in SQLite and notifies the runner. Feedback goes to the async agent, not through the terminal. *(source: user request)*

33. The runner shall detect feedback and resume the agent session with `--resume {sessionId}` and feedback as context. *(source: v2 architecture)*

### Execution UI

34. Task cards shall show an execution indicator when a session is active for that task, distinguishing autonomous work from manual. *(source: user request)*

35. Task detail shall include an "Execution" tab that reads the Claude session file (JSONL) and renders conversation entries: user prompts, assistant responses, tool calls (collapsible), errors. *(source: v2 architecture + user request)*

36. Project overview shall show execution status (which sessions are running, per task group). *(source: inferred)*

## Out of Scope

* Auto-commit, push, PR creation (future milestone — dev owns review)

* Mastra / LangGraph / XState (replaced by loop + SQLite)

* Long-running agents (spawn per task, exit when done)

* Cross-repo task groups (future — single repo per group first)

* Container network firewall customization UI (CLI config only for now)

* Agent SDK TypeScript library (start with `claude -p`, extract AgentRuntime interface when coupling friction appears)

* Agent-generated memories (structured output captures summary only; memories deferred)

* Automatic retries (manual retry only via UI)

* Task group locking during execution (single-user, runner re-reads task list each iteration)

* Task group Paused/Stopped states and Pause/Resume/Restart controls (future — current groups are either running or not, stop kills the runner and group stays active for manual restart)

* Repos outside workspace boundaries in task groups (FR-6.12 — future, workspace repos sufficient for now)

* Read-only main branch bind mounts in containers (NF-7 — low risk since agents always work in worktrees, not main)

* Crash recovery on daemon restart (NF-10 — future, manual retry sufficient for now. Tasks left in `in_progress` with stale `subStatus` after a crash can be manually retried)

* Worktree cleanup after PR merge (future PR/merge milestone — worktrees retained after execution for review and PR creation)

* Worktree removal on project delete (follow-up)

## Task Groups

### TG1: Dev Container Infrastructure

`@devcontainers/cli` integration on the client daemon, workspace settings UI, terminal into containers. This is TG1 so the user can immediately start executing tasks manually in dev containers.

**Tasks:**

1. **Add container config and execution settings to workspaces schema**

   * Add `containerEnabled integer('container_enabled', { mode: 'boolean' }).default(false)` to workspaces

   * Add `containerConfig text('container_config', { mode: 'json' }).$type<ContainerConfig>()` to workspaces (allowedDomains, extraPackages, envVars, idleTimeout)

   * Add `maxConcurrency integer('max_concurrency').default(1)` to workspaces (controls parallel task execution within groups)

   * Add `autoStart integer('auto_start', { mode: 'boolean' }).default(false)` to workspaces (auto-start runner when tasks marked as AI)

   * Generate migration

   * Update tRPC workspace router to accept/return new fields

   * *Implements FR #8, #26*

2. **Add container WebSocket protocol messages**

   * `CONTAINER_UP_REQUEST/RESPONSE`, `CONTAINER_STATUS_REQUEST/RESPONSE`, `CONTAINER_DOWN_REQUEST/RESPONSE`

   * Add to WsMessage, ClientToServerMessage, ServerToClientMessage unions

   * Add pending maps to AppState: `pendingContainerUp`, `pendingContainerDown`, `pendingContainerStatus`

   * Add dispatch functions and response handlers following existing `dispatchGitOp` pattern

   * *Implements FR #9*

3. **Create container manager on client daemon**

   * `client/src/container/manager.ts`: ContainerManager class

   * `up(workspaceFolder, config)`: runs `devcontainer up --workspace-folder {path}`, returns container ID

   * `exec(workspaceFolder, command, args, env)`: runs `devcontainer exec --workspace-folder {path} --remote-env KEY=VALUE ... {command} {args}`

   * `down(workspaceFolder)`: stops container

   * `status(workspaceFolder)`: checks if container is running

   * Uses `child_process.spawn` with JSON output parsing

   * Bind-mount host `~/.claude` into container for OAuth tokens, global config, and state data

   * *Implements FR #9*

4. **Handle container WS messages in client daemon**

   * `client/src/ws/client.ts`: add cases for `CONTAINER_UP_REQUEST`, `CONTAINER_DOWN_REQUEST`, `CONTAINER_STATUS_REQUEST`

   * Delegates to ContainerManager

   * *Implements FR #9*

5. **Generate devcontainer config for workspace**

   * `client/src/container/config-generator.ts`: generates `.devcontainer/devcontainer.json` in workspace docsDir (one per workspace, not per repo)

   * Uses Anthropic reference config as base: `ghcr.io/anthropics/devcontainer-features/claude-code:1`

   * Adds `init-firewall.sh` with default-deny + allowlist (npm, GitHub, Claude API + workspace custom domains)

   * Bind-mounts all workspace repos **and project dirs** (any `--add-dir` paths) at their original paths

   * Bind-mounts host `~/.claude` for OAuth tokens, global config, and state data

   * Rewrites `localhost` URLs to `host.docker.internal` in `containerEnv` (e.g., `ENGY_SERVER_URL`), following the pattern from Anthropic's reference config where the firewall allows host network access via `HOST_NETWORK` detection

   * Triggered on first container start if `.devcontainer/` doesn't exist

   * *Implements FR #10, #10a*

6. **Route all terminals through container when enabled**

   * Extend `TerminalSpawnCmd` to accept optional `containerWorkspaceFolder` field

   * When `containerEnabled=true` on the workspace, **all** terminal spawns (from the terminal panel, background processes, and UI-initiated xterm sessions) automatically route through `devcontainer exec --workspace-folder {path} /bin/bash` instead of local `pty.spawn`

   * No separate "Open Container Terminal" button needed — all terminals are container terminals when devcontainers are enabled, local terminals when disabled

   * Full xterm features: persistence via circular buffer, reconnect with buffer replay, resize, kill — same as local terminals

   * *Implements FR #12, #13*

7. **Add container settings to workspace settings UI**

   * `web/src/components/workspace/container-settings.tsx`: toggle containerEnabled, edit allowedDomains list, extraPackages, envVars, idleTimeout

   * Wire to workspace update tRPC mutation

   * Add container status indicator (running/stopped) to workspace overview

   * *Implements FR #8, #13*

### TG2: Runner Loop & Agent Spawning

The core execution engine on the client daemon. A for loop, a spawn, a database write. Includes execution schema, protocol, and worktree management.

**Tasks:**

1. **Add execution schema and WebSocket protocol**

   * Add to tasks table: `subStatus text('sub_status')` (nullable, enum: planning/implementing/blocked/failed), `sessionId text('session_id')` (nullable), `feedback text('feedback')` (nullable)

   * Update existing `agentSessions` table — add `taskId` FK (nullable), `executionMode` text (nullable, enum: group/task/milestone), `completionSummary` text (nullable), `worktreePath text('worktree_path')` (nullable — path to the worktree for this session)

   * Generate migration with `pnpm drizzle-kit generate`

   * Update tRPC task router to accept/return subStatus, sessionId, feedback

   * Update MCP updateTask tool schema

   * Add WS protocol messages: `EXECUTION_START_REQUEST` (pre-built prompt + flags), `EXECUTION_STOP_REQUEST`, `EXECUTION_STATUS_EVENT` (session started), `EXECUTION_COMPLETE_EVENT` (session done/failed)

   * Add dispatch functions and pending maps for execution messages following existing patterns

   * *Implements FR #17, #18, #19*

2. **Create agent spawner**

   * `client/src/runner/agent-spawner.ts`: AgentSpawner class

   * `spawn(config: SpawnConfig): Promise<SpawnResult>` — spawns `claude -p` process

   * Host mode: `spawn('claude', ['-p', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`

   * Container mode: `containerManager.exec(workspaceFolder, 'claude', ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`

   * **Hard validation**: assert containerMode === true before allowing `--dangerously-skip-permissions`. Throw if this flag would be used on host.

   * Receives pre-built prompt, flags, and system prompt from the execution router (same as quick actions). Writes prompt to stdin, closes stdin.

   * Monitors stdout for structured completion output from `--json-schema` (taskCompleted, summary). Claude writes session files natively — UI reads them directly.

   * Generates UUID for `--session-id` before spawn (stored on session record)

   * Supports `--resume {sessionId}` for retry/feedback continuation

   * Timeout with SIGTERM → SIGKILL

   * Returns: `{ sessionId, exitCode, success, completion: { taskCompleted, summary } }`

   * TASK_COMPLETION_SCHEMA: `{ taskCompleted: boolean, summary: string }`

   * Unit tests

   * *Implements FR #14, #20, #21, #22, #23*

3. **Create runner**

   * `client/src/runner/index.ts`: Runner class — a thin wrapper around the agent spawner that manages worktree lifecycle and WS communication. The agent itself handles task orchestration.

   * `start(prompt, flags, config)`: creates worktree from local main, creates session record with `worktreePath`, spawns agent with the pre-built prompt. Worktrees are **retained** after completion (needed for diff review, feedback, future PR creation).

   * `stop()`: kills current agent process, preserves worktree

   * `retry(sessionId)`: re-spawn agent with `--resume {sessionId}` in the same worktree

   * Emits typed WS events: EXECUTION_STATUS_EVENT, EXECUTION_COMPLETE_EVENT

   * Stores structured completion output (summary) on session record

   * *Implements FR #16, #19, #25, #26*

4. **Wire runner to client daemon WS handler**

   * `client/src/ws/client.ts`: handle `EXECUTION_START_REQUEST` → delegates to Runner.start

   * Handle `EXECUTION_STOP_REQUEST` → delegates to Runner.stop

   * Runner events flow back through WS to server

   * *Implements FR #17*

5. **Create execution tRPC router**

   * `web/src/server/trpc/routers/execution.ts`:

   * `startExecution({ scope, id })` — builds the same prompt and flags that the corresponding quick action uses (task → task-quick-actions, task group → TG quick action, milestone → milestone-quick-actions). Reuses `buildClaudeCommand` logic with `--append-system-prompt` + `--add-dir` flags. Dispatches EXECUTION_START_REQUEST with prompt + config to daemon.

   * `stopExecution(sessionId)` — dispatches stop

   * `retryExecution(sessionId)` — dispatches retry (resume in same worktree)

   * `getSessionFile(sessionId)` — resolves session file path from `~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`, reads and returns content for execution log viewer

   * `getActiveSessions({ projectId? })` — lists active/recent sessions with worktree paths (for terminal scope and diff viewer)

   * Wire to app router

   * Tests

   * *Implements FR #16, #24*

6. **Server-side execution event handling**

   * `web/src/server/ws/server.ts`: when receiving EXECUTION_STATUS_EVENT, update session state in SQLite

   * When receiving EXECUTION_COMPLETE_EVENT, update session status (done/failed), store completion summary on session record

   * Broadcast status changes to UI via tRPC invalidation

   * No output event handling — execution logs live in Claude's session files, read directly by the UI

   * *Implements FR #19*

7. **Scope diff viewer to session worktree paths**

   * `web/src/server/trpc/routers/diff.ts`: look up the active session's `worktreePath` for the given task/task-group and pass it as `repoDir` to existing git diff operations

   * Frontend: add a **session selector dropdown** to the diff viewer — lists active and recent sessions with their worktree paths. Default to the most recent active session.

   * Enables reviewing agent diffs while execution is in progress

   * *Implements FR #31*

8. **Add worktree sessions to terminal scope**

   * Extend the terminal dock's "New Terminal" dropdown to show active session worktrees alongside workspace repos. Group under a "Worktrees" section — each entry shows session branch name and target repo.

   * Clicking opens a terminal `cd`'d into the worktree path (routes through container when `containerEnabled`)

   * Uses existing terminal scope infrastructure (`use-terminal-scope.ts`) — add a worktree scope type that reads `worktreePath` from active sessions via a new `execution.getActiveSessions()` query

   * *Implements FR #12*

9. **Add "Execute" action to quick action dropdowns**

   * `web/src/components/projects/task-quick-actions.tsx`: add "Execute in Background" to the existing 3-dot dropdown alongside "Implement". Calls `execution.startExecution({ scope: 'task', id: taskId })` instead of opening a terminal. Same prompt, headless.

   * `web/src/components/projects/milestone-quick-actions.tsx`: add "Execute Milestone" to dropdown. Calls `execution.startExecution({ scope: 'milestone', id: milestoneRef })`.

   * `web/src/components/projects/milestone-list.tsx` (TaskGroupQuickAction): add "Execute Task Group" to dropdown. Calls `execution.startExecution({ scope: 'taskGroup', id: groupId })`.

   * Show running/completed status indicator on the quick action button when a session is active for that scope

   * *Implements FR #15*

### TG3: Execution UI

Task-level execution indicators, structured log viewer, project-level status. Now that the runner is working (TG2), the UI needs to show execution state.

**Tasks:**

1. **Add auto-implement indicator to task cards**

   * Modify `task-card.tsx` — task cards already show milestone badge, task group badge, and type indicator. Add a subStatus indicator alongside existing badges.

   * When `subStatus` is set: show icon (spinner for implementing, pause for blocked, alert for failed, brain for planning)

   * Distinguish from manual in_progress (no subStatus = manual work)

   * *Implements FR #34*

2. **Create execution tab in task detail**

   * `web/src/components/tasks/execution-tab.tsx`: session file viewer

   * Reads Claude's session file via `execution.getSessionFile(sessionId)` — parses JSONL entries (UserEntry, AssistantEntry, tool calls). Polls for updates **only while the execution tab is open** — no background file watching. Component mounts → start polling, unmounts → stop.

   * Renders conversation entries: user prompts, assistant responses, tool calls (collapsible with input/output), errors (highlighted)

   * Session ID display, duration, status, structured completion summary

   * "Retry" button for failed tasks, "Stop" button for running tasks

   * *Implements FR #35*

3. **Add execution status to project overview**

   * Integrate into existing expandable milestone/task group layout in `milestone-list.tsx` (task groups already render with `TaskGroupQuickAction` — extend with execution state)

   * Show which task groups are currently executing, current task per group with subStatus

   * Container status if containers enabled

   * Quick actions: start group, stop group, open container terminal (extend existing `TaskGroupQuickAction`)

   * *Implements FR #36*

4. **Update MCP to expose execution data**

   * `getProjectDetails`: include active session worktree paths and execution status for task groups

   * *Implements FR #2*

5. **Run /engy:review, pnpm blt, test in Chrome**

   * Final validation task

   * *Implements verification*

### TG4: Questions System & Feedback Loop

Agent-initiated questions during planning, UI queue, feedback from diff viewer. Includes questions schema.

**Tasks:**

1. **Create questions table**

   * New table: `questions` (id, taskId, sessionId, documentPath, question, header, options JSON, multiSelect, answer, createdAt, answeredAt)

   * `taskId` — nullable FK to tasks (null for session-scoped questions outside task context)

   * `sessionId` — required, identifies the agent session (grouping key for non-task questions)

   * `documentPath` — nullable, path to the spec/plan doc the agent was reading (for UI context tab)

   * `header` — short chip label (max 12 chars) for quick scanning

   * `options` — JSON array of `{ label, description, preview? }` (structured choices modeled after Claude Code's AskUserQuestion)

   * `multiSelect` — boolean, whether multiple options can be selected

   * Generate migration with `pnpm drizzle-kit generate`

   * *Implements FR #27, #28*

2. **Add askQuestion MCP tool**

   * `web/src/server/mcp/index.ts`: register `askQuestion` tool

   * Modeled after Claude Code's native `AskUserQuestion` tool. Input schema:

```typescript
{
  sessionId: string,        // agent session (required, grouping key)
  taskId?: number,          // task being planned (optional)
  documentPath?: string,    // spec/plan doc the agent is reading
  questions: [{             // 1-4 batched questions
    question: string,       // "Which auth method should we use?"
    header: string,         // max 12 chars, e.g. "Auth method"
    multiSelect: boolean,
    options: [{             // 2-4 structured choices (+ auto "Other")
      label: string,
      description: string,
      preview?: string      // optional markdown for side panel
    }]
  }]
}
```

* **Server-side validation**: if `taskId` is provided, looks up task's `subStatus` and rejects with error if not `planning`. If `taskId` is omitted (session-scoped), no subStatus check.

* Writes one row per question to questions table (persisted in SQLite). If `taskId` is set, sets task `subStatus` to `blocked`. Returns `{ status: 'blocked', questionIds: number[] }`

* Agent system prompt instructs: "If you need clarification during planning, call askQuestion with structured options and exit. Batch related questions into a single call (up to 4). Include documentPath so the user can reference the spec."

* *Implements FR #27, #30*

3. **Create questions tRPC router**

   * `web/src/server/trpc/routers/question.ts`:

   * `list({ taskId?, sessionId?, unanswered? })` — list questions, optionally filtered. Returns questions with full options JSON for rendering.

   * `submitAnswers({ answers: [{ questionId, answer }] })` — batch-writes answers (string for single-select/free text, JSON array for multi-select) for all questions in a group. Only unblocks the task (clears `subStatus` from `blocked`) and notifies the runner **after all questions in the group are answered** — partial submissions are rejected. This ensures the agent always gets a complete set of answers when it resumes.

   * `get(questionId)` — single question with task context (task title, description) and `documentPath` for the Document tab

   * `unansweredCount()` — returns count for notification badge (counts groups with any unanswered questions, not individual questions)

   * Tests

   * *Implements FR #28, #29*

4. **Runner integration for questions and feedback**

   * Runner checks for answered questions on blocked tasks each loop iteration

   * When answer found: spawn new agent with answer as context (task description + "Previous question: ... Answer: ...")

   * When feedback found on a task: spawn agent with `--resume {sessionId}` and feedback text as the prompt

   * Clear feedback field after spawning

   * *Implements FR #29, #33*

5. **Add task-record feedback path to diff viewer**

   * Modify existing `web/src/components/diff/review-actions.tsx` — currently "Send Feedback" pastes into the active terminal. Add an alternative path: when viewing diffs for a task with active runner execution, "Send Feedback" writes to `task.update({ feedback: text })` instead of the terminal.

   * Terminal-based feedback remains for non-runner contexts (manual work, no active execution)

   * Show feedback target indicator: "Sending to runner agent" vs "Sending to terminal"

   * *Implements FR #32*

6. **Create question dialog UI**

   * `web/src/components/questions/question-list.tsx`: notification-triggered panel listing tasks with unanswered questions

   * `web/src/components/questions/question-dialog.tsx`: task-scoped dialog for answering all questions for one task

   * **Notification badge** in project header — shows total unanswered question count, clicking opens the question list

   * **Question list** — two sections: (a) task-scoped entries grouped by task (shows task title + unanswered count), (b) session-scoped entries (no task) where each session is its own entry. Clicking any entry opens its question dialog.

   * **Question dialog** scoped to a single task or session, with tabs:

     * **One tab per question** — labeled by `header` chip (e.g. "Auth", "ORM"). Each tab shows the question text, structured options list (label + description), optional preview panel rendered as **HTML via markdown** (not monospace — full rich rendering since we have a browser), multi-select support via checkboxes, free-text "Other" input. Unanswered tabs show a dot indicator.

     * **Task tab** (only when `taskId` is set) — task title and description (stays fixed — shared context for all questions)

     * **Document tab** (when `documentPath` is set) — reuses the existing document editor component in read-only mode for consistency (stays fixed — all questions from one askQuestion call share the same document context)

     * Single **"Submit All"** button in dialog footer — disabled until all questions have answers

   * Questions persist across page refresh (backed by SQLite)

   * *Implements FR #28*

## Test Scenarios

### Session Worktree Lifecycle

```text
Given a task group "backend-api" in a workspace with repos ["/path/to/repo"]
When the user starts execution on the task group
Then the runner creates a worktree from local main: git worktree add -b backend-api {repo}/.claude/worktrees/backend-api
And stores worktreePath on the session record
And all tasks in the group execute in this worktree
And diffs show changes in the session worktree

When all tasks complete
Then the worktree is retained for diff review and future PR creation
And the session record still references the worktree path
```

### Agent Execution (Host Mode)

```text
Given a task with status "todo" and type "ai" in a task group
And containers are disabled on the workspace
When the runner picks up this task
Then it generates a UUID and creates a session record with worktreePath
And sets status to "in_progress" and subStatus to "implementing"
And spawns: claude -p --output-format stream-json --permission-mode acceptEdits --session-id {uuid} --json-schema {TASK_COMPLETION_SCHEMA}
And does NOT use --dangerously-skip-permissions (hard validation)
And writes the same prompt that task-quick-actions builds to stdin
And passes --append-system-prompt with project context and --add-dir flags (same as UI quick actions)
And Claude writes session output to ~/.claude/projects/{encoded-worktree-path}/{uuid}.jsonl
When the agent exits with code 0 and structured output { taskCompleted: true, summary: "..." }
Then task status is set to "done" and subStatus is cleared
And completion summary is stored on the session record
And runner advances to next ai task (skips human tasks)
```

### Agent Execution (Container Mode)

```text
Given a task in a workspace with containerEnabled=true
When the runner picks up this task
Then it ensures the container is running (devcontainer up if needed)
And spawns: devcontainer exec ... claude -p --output-format stream-json --dangerously-skip-permissions --json-schema {TASK_COMPLETION_SCHEMA}
And the agent writes session output to ~/.claude/projects/... (accessible on host via bind mount)
When the agent exits
Then task status is updated accordingly
And structured completion output is parsed and stored
```

### Milestone Execution (Container Mode)

```text
Given a milestone "m6" in project "initial" with containerEnabled=true
When the user clicks "Implement in Container" on the milestone card
Then the server builds the same prompt as the current quick action: "Use /engy:implement-milestone for m6 in project initial"
And dispatches to the daemon with add-dir flags for workspace repos
And the daemon ensures the container is running
And spawns a single agent: devcontainer exec ... claude '{prompt}' --dangerously-skip-permissions
The agent runs the /engy:implement-milestone skill autonomously in the container
When the agent exits
Then execution status is reported back to the UI
```

### Parallel Execution

```text
Given a task group with tasks A, B, C where A has no dependencies, B depends on A, C has no dependencies
When the runner starts the group with concurrency=2
Then it spawns agents for A and C simultaneously
When A completes successfully
Then B is unblocked and the runner spawns an agent for B
```

### Questions Flow

````text
Given a task with subStatus "planning"
When the agent calls askQuestion MCP tool with:
  sessionId="abc-123", taskId=42, documentPath="projects/initial/m6-execution-engine.plan.md",
  questions=[
    { question: "Which auth method?", header: "Auth", multiSelect: false,
      options: [
        { label: "JWT tokens", description: "Stateless, good for APIs",
          preview: "```ts\nconst token = jwt.sign(payload, secret)\n```" },
        { label: "Session cookies", description: "Server-side state, simpler" }
      ]
    },
    { question: "Which ORM features?", header: "ORM", multiSelect: true,
      options: [
        { label: "Migrations", description: "Schema versioning" },
        { label: "Seeding", description: "Test data generation" }
      ]
    }
  ]
Then two question records are created in SQLite (one per question, persisted across refresh)
And the task subStatus is set to "blocked"
And the agent process exits
And the runner skips this task and moves to next
And the notification badge shows "1" (one task group with unanswered questions)

When the user clicks the notification badge
Then the question list shows task #42 with "2 unanswered"
When the user clicks on the task entry
Then a question dialog opens with tabs: "Auth", "ORM", "Task", "Document"
And the "Auth" tab shows "Which auth method?" with JWT/Session options
And selecting "JWT tokens" renders the preview markdown as HTML in the side panel
And the "ORM" tab shows checkboxes for Migrations and Seeding
And the "Task" tab shows the task's title and description
And the "Document" tab shows the m6 plan doc in the read-only document editor
And the "Submit All" button is disabled until both questions have answers

When the user answers both questions and clicks "Submit All"
Then both question records are updated with answers in a single batch
And the notification badge clears (no remaining unanswered groups)
And the task subStatus is cleared from "blocked"
And on next loop iteration, the runner spawns a new agent with the answers as context
````

### Feedback Loop

```text
Given a completed task with diffs in the worktree
When the user views diffs and clicks "Send Feedback" with "The error handling is wrong"
Then feedback is written to the task record
And task status is set back to "in_progress" with subStatus "implementing"
And the runner spawns agent with --resume {sessionId} and feedback as prompt
```

### One-Off Task Execution

```text
Given a task not in any task group
When the user clicks "Execute" on the individual task
Then a worktree is created from local main
And the agent runs in the worktree
When the task completes
Then the worktree is retained for review
```

### Planning Phase (needsPlan)

```text
Given a task with needsPlan=true and type "ai"
When the runner picks up this task
Then it sets subStatus to "planning" (not "implementing")
And spawns a planning agent with askQuestion MCP tool registered
When the agent calls askQuestion with taskId, documentPath, and batched questions
Then one row per question is written to the questions table
And the task becomes blocked
And the runner moves to the next task

Given a task with needsPlan=false and type "ai"
When the runner picks up this task
Then it sets subStatus to "implementing" directly
And spawns an implementation agent without askQuestion tool
```

### Auto-Start (Single Task)

```text
Given a workspace with autoStart enabled
And a task with type "human" and no runner currently active
When the user changes the task type to "ai"
Then the system starts a new runner for this task
And creates a worktree from local main
And sets subStatus to "planning" or "implementing" based on needsPlan
And spawns an agent without requiring a manual "Execute" click
```

### Container Idle Timeout

```text
Given a workspace with containerEnabled=true and idleTimeout=10
And a running container with no active task agents and no connected terminals
When 10 minutes elapse with no new processes starting
Then the container is torn down
But if a terminal is opened during the idle period, the timer resets
```

### Hard Validation

```text
Given a workspace with containerEnabled=false
When the runner attempts to spawn with --dangerously-skip-permissions
Then the agent spawner throws an error and refuses to spawn
And the task is marked as failed with error message
```

## Key Design Decisions

1. **Agent is the orchestrator.** The runner doesn't manage tasks, dependencies, or ordering. It just creates a worktree, spawns an agent with the same prompt quick actions build, and reports status. The agent handles everything else.

2. **Runner = headless quick action.** Same prompt, same flags, same `--append-system-prompt`, same `--add-dir`. Only difference: worktree creation and headless execution instead of terminal.

3. **Container is the sandbox.** `--dangerously-skip-permissions` ONLY in containers (hard validated). Firewall + bind mount is the boundary.

4. **Logs from session files, not DB.** Claude writes JSONL session files to `~/.claude/projects/...`. UI reads them directly — no stream-to-DB pipeline. Accessible from host for both host and container execution via bind mount.

5. **Per-session worktrees from local main.** Runner creates a worktree before spawning, stores path on session record. Worktrees retained after completion (needed for diff review, feedback, future PR). Cleanup deferred to PR/merge milestone.

6. **UUID session-id set by runner.** Generate before spawn, store immediately. No parsing from output.

7. **Structured completion via --json-schema.** Runner gets programmatic success signal + summary from every agent invocation.

8. **Dev containers first (TG1).** Enables manual task execution in containers immediately, before the runner is built.

9. **One container per workspace.** Shared across all sessions. Cheaper, faster. Agent isolation is via worktrees, not containers.

10. **Mount ~/.claude in containers.** OAuth tokens, global config, state data, and session files persist. Same auth mechanism as host.

11. **Manual retry only.** No automatic retries. Failed sessions stay failed until user clicks Retry.

12. **Auto-start is opt-in.** When enabled, tasks changing to `type: ai` auto-start a runner.

13. **Reuse agentSessions table.** Extend with taskId, executionMode, completionSummary, and worktreePath.
