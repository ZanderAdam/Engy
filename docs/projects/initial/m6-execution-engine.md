***

title: Execution Engine\
status: draft
-------------

# Plan: M6 Execution Engine

## Overview

M6 delivers the autonomous execution runtime for Engy v2. A simple runner loop on the client daemon spawns short-lived Claude CLI agents per task, tracks execution state in SQLite, and streams structured logs to the UI. Dev containers provide optional sandboxed execution with `--dangerously-skip-permissions`. Git worktrees isolate work at two levels: every workspace repo gets a per-project worktree (so spec files and terminals resolve through the worktree), and task-group worktrees branch from the project worktree (so each group's implementation is isolated). A questions system enables agents to ask for clarification during planning, and a feedback loop lets devs kick back implementation results via the diff viewer.

No frameworks. The orchestrator is a for loop and a spawn. SQLite is the state machine.

Boundary: no auto-commit/push/PR (future milestone), no Mastra, no long-running agents, no workflow engine, no cloud sandboxes, no agent-generated memories (future milestone).

## Codebase Context

**What M1-M5 shipped:**

* SQLite schema: workspaces, projects, taskGroups, tasks, taskDependencies, agentSessions, fleetingMemories, projectMemories, comments, commentThreads

* WebSocket protocol: REGISTER, VALIDATE_PATHS, SEARCH_FILES, FILE_CHANGE, GIT_STATUS/DIFF/LOG/SHOW/BRANCH_FILES, terminal relay (spawn/input/resize/kill/reconnect)

* Client daemon: WS client with reconnect, git ops via `simple-git` + `execFile`, file watcher (chokidar), terminal manager (node-pty), session manager with circular buffer

* Server: tRPC API (workspace, project, task, task-group, milestone, comment, dir, diff routers), MCP server (13 tools), WebSocket dispatch with pending maps

* UI: Next.js App Router, shadcn/ui, xterm.js terminal panel, diff viewer, task views (kanban, eisenhower, dependency graph)

**Existing worktree context doc** (`context/worktrees.md`): detailed plan for project-level worktrees — `worktreePaths: Record<string, string>` on projects table, `effectiveWorkspace()` and `effectiveRepos()` helpers, WS protocol for `GIT_WORKTREE_ADD_REQUEST/RESPONSE`. M6 implements project-level worktrees from this doc AND adds task-group-level worktrees branched from the project worktree.

**Old Engy3 reference** (`engy3/websocket/src/workflow/executors/`): LlmExecutor spawning `claude -p --output-format json`, ClaudeExecutionManager wrapping prompts with task context + memories + aggregated issues and requiring structured completion output via `--json-schema` (TASK_COMPLETION_SCHEMA: taskCompleted, summary, memories), ValidationRunner for shell + claude-code validations. M6 replaces XState with a plain loop but preserves the structured output pattern.

## Affected Components

| File                                                      | Change                                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/server/db/schema.ts`                             | **Modify** — add subStatus/sessionId/feedback to tasks, worktreePaths to projects + taskGroups, container config + maxConcurrency to workspaces, update agentSessions for execution tracking, new questions table, new executionLogs table |
| `common/src/ws/protocol.ts`                               | **Modify** — add worktree add/remove, execution commands (start/stop/status/output), container lifecycle messages                                                            |
| `client/src/runner/index.ts`                              | **Create** — runner loop: pick task, spawn agent, track status, handle questions/feedback, parallel execution                                                                |
| `client/src/runner/agent-spawner.ts`                      | **Create** — spawn `claude -p` or `devcontainer exec ... claude -p`, parse stream-json, structured completion via `--json-schema`                                            |
| `client/src/runner/stream-parser.ts`                      | **Create** — parse NDJSON stream-json events into structured log entries                                                                                                     |
| `client/src/git/index.ts`                                 | **Modify** — add worktree add/remove/list functions                                                                                                                          |
| `client/src/container/manager.ts`                         | **Create** — @devcontainers/cli integration (up/exec/down)                                                                                                                   |
| `client/src/ws/client.ts`                                 | **Modify** — handle execution and container WS commands                                                                                                                      |
| `web/src/server/trpc/routers/execution.ts`                | **Create** — start/stop/retry execution, execution status, log queries                                                                                                       |
| `web/src/server/trpc/routers/question.ts`                 | **Create** — questions CRUD, answer submission                                                                                                                               |
| `web/src/server/trpc/routers/project.ts`                  | **Modify** — project-level worktreePaths, effectiveWorkspace, effectiveRepos, update all spec procedures                                                                     |
| `web/src/server/trpc/routers/task.ts`                     | **Modify** — add subStatus to task updates                                                                                                                                   |
| `web/src/server/trpc/routers/task-group.ts`               | **Modify** — task-group worktreePaths, execution state                                                                                                                       |
| `web/src/server/trpc/routers/workspace.ts`                | **Modify** — container config settings, maxConcurrency                                                                                                                       |
| `web/src/server/trpc/routers/diff.ts`                     | **Modify** — server resolves worktree paths from project/task-group records, passes as repoDir for worktree-scoped diffs                                                     |
| `web/src/components/diff/worktree-selector.tsx`           | **Create** — dropdown for selecting which worktree to review (project-level or task-group-level)                                                                              |
| `web/src/server/mcp/index.ts`                             | **Modify** — add askQuestion tool (based on existing Claude askQuestion tool pattern), expose worktree paths                                                                 |
| `web/src/server/ws/server.ts`                             | **Modify** — dispatch worktree ops, execution commands, container commands                                                                                                   |
| `web/src/server/trpc/context.ts`                          | **Modify** — add pending maps for new WS operations                                                                                                                          |
| `web/src/components/tasks/execution-tab.tsx`              | **Create** — structured log viewer in task detail                                                                                                                            |
| `web/src/components/tasks/task-card.tsx`                  | **Modify** — auto-implement icon/badge for subStatus                                                                                                                         |
| `web/src/components/questions/question-queue.tsx`         | **Create** — question queue UI component                                                                                                                                     |
| `web/src/components/diff/feedback-sender.tsx`             | **Create** — send feedback to runner (not terminal)                                                                                                                          |
| `web/src/components/workspace/container-settings.tsx`     | **Create** — container config in workspace settings                                                                                                                          |
| `web/src/components/projects/create-project-dialog.tsx`   | **Modify** — add "Create git worktree" checkbox                                                                                                                              |
| `web/src/components/projects/project-overview.tsx`        | **Modify** — retroactive "Create Worktree" button                                                                                                                            |
| `web/src/components/projects/task-quick-actions.tsx`      | **Modify** — use effectiveRepos from project                                                                                                                                 |
| `web/src/components/projects/milestone-quick-actions.tsx` | **Modify** — use effectiveRepos from project                                                                                                                                 |
| `web/src/components/terminal/use-terminal-scope.ts`       | **Modify** — use effectiveRepos from project                                                                                                                                 |

## Functional Requirements

### Git Worktrees

1. The system shall support two levels of worktrees: **project-level** (one worktree per repo per project for ALL workspace repos, stored on the projects table) and **task-group-level** (one worktree per repo per task group, branched from the project worktree). Every workspace repo gets a project worktree — this is the base that task-group worktrees branch from. *(source: user request + context/worktrees.md)*

2. Project-level worktrees shall be created for ALL workspace repos per `context/worktrees.md`: `worktreePaths: Record<string, string>` on the projects table, `effectiveWorkspace()` rewrites docsDir through worktree, `effectiveRepos()` replaces repo paths. Path: `{repo}/.claude/worktrees/{project-slug}`, branch: `{project-slug}`. *(source: context/worktrees.md)*

3. Task-group-level worktrees shall be created when a task group starts execution, branched from the project worktree (not from main). Path: `{repo}/.claude/worktrees/{project-slug}/{group-slug}`, branch: `{project-slug}/{group-name}`. Requires project-level worktrees to exist first. *(source: v2 architecture, spec FR-6.1, context/sdd-workflow.md)*

4. The system shall remove task-group worktrees when a task group completes or is stopped. Project-level worktrees persist with the project. *(source: inferred — cleanup)*

5. The system shall store task-group worktree paths as `worktreePaths: Record<string, string>` on the task group record. *(source: context/worktrees.md, adapted)*

6. The system shall provide `effectiveRepos()` helper that replaces repo paths with worktree paths for terminal scoping and diff viewing. *(source: context/worktrees.md)*

7. All worktree creation/removal goes through client daemon via WebSocket (server never touches repos). *(source: context/worktrees.md)*

### Dev Containers

8. The system shall support optional per-workspace Docker containers enabled via workspace settings (`containerEnabled`, `allowedDomains`, `extraPackages`, `envVars`, `idleTimeout`). *(source: v2 architecture)*

9. The system shall manage **one container per workspace** via `@devcontainers/cli`: `devcontainer up` on first use (or when task group starts), `devcontainer exec` for running agents, tear down after configurable idle timeout when idle. **Idle** = no running task agents AND no connected container terminals (no processes currently executing against the dev container). Shared across all task groups in the workspace. *(source: v2 architecture + elicited)*

10. The system shall provide a base `.devcontainer/devcontainer.json` in the **workspace docsDir** using Anthropic's reference config (`ghcr.io/anthropics/devcontainer-features/claude-code:1`), with network firewall (default-deny, whitelist npm/GitHub/Claude API + workspace additions). All workspace repos **and project dirs** (any `--add-dir` paths passed to claude) are bind-mounted into the container. Host `~/.claude` directory is bind-mounted for OAuth tokens, global config, and state data persistence. See `context/anthropic-devcontainer-reference.md` for exact Anthropic reference files (devcontainer.json, Dockerfile, init-firewall.sh) and Engy adaptation notes. *(source: v2 architecture + elicited)*

10a. The system shall rewrite `localhost` URLs to `host.docker.internal` equivalents in container environment variables. Following the pattern from Anthropic's reference config (which allows host network access via `HOST_NETWORK` in the firewall), any host-local URLs (e.g., `ENGY_SERVER_URL=http://localhost:3000`) must be rewritten to `http://host.docker.internal:3000` when passed as `containerEnv` or `remoteEnv` to `devcontainer exec`. This ensures MCP server connections, API endpoints, and other localhost services remain reachable from inside the container. *(source: Anthropic reference config host network pattern + user request)*

11. The system shall fall back to direct host execution when containers are disabled. *(source: v2 architecture)*

12. The system shall support opening a full xterm terminal into a running container with the same persistence, reconnect, and circular buffer capabilities as local terminals. Container terminals use `devcontainer exec --workspace-folder {path} /bin/bash` instead of local `pty.spawn`, but all xterm features (resize, kill, reconnect with buffer replay) remain. *(source: user request — same terminal experience in containers)*

13. When containers are enabled, **ALL Claude-related execution runs in containers** — not just orchestrated agent spawns. This includes: (a) runner-spawned task agents, (b) one-off task execution from the UI, (c) all terminals opened from the terminal panel on the right side of the UI, (d) background processes spawned by Claude. Any xterm session or Claude invocation, whether initiated by the runner or manually via the UI, must route through `devcontainer exec` when `containerEnabled=true` on the workspace. *(source: v2 architecture + user request)*

14. **Hard validation**: The system shall NEVER allow `--dangerously-skip-permissions` to be used outside of a container. The agent spawner must validate that this flag is only passed when executing via `devcontainer exec`. If containerEnabled is false on the workspace, the flag must not be used regardless of any other configuration. *(source: user request — safety critical)*

### Runner Loop

15. The system shall provide a runner loop on the client daemon that processes tasks within a task group: pick next pending task, spawn agent, wait for exit, update status, repeat. The runner only processes `type: 'ai'` tasks — `type: 'human'` tasks are skipped and left for manual completion. A task group completes when all tasks (ai + human) are done. *(source: v2 architecture + elicited)*

16. The system shall support **parallel execution** of independent tasks within a task group. When tasks have no dependency relationships (`blockedBy` is empty or all blockers are done), the runner may spawn multiple agents concurrently up to `maxConcurrency` (per-workspace setting on workspaces table, default 1 = sequential). *(source: user request + elicited)*

17. The system shall support three execution modes: (a) **task group execution** — runner processes tasks in a group sequentially/parallel, (b) **individual task execution** — one-off tasks get an ephemeral worktree branched from the project worktree, cleaned up after completion, (c) **milestone execution** — a single agent runs the existing `/engy:implement-milestone` skill prompt in a dev container (same prompt as the current milestone quick action, but via `devcontainer exec` instead of local terminal). *(source: user request + v2 architecture + elicited)*

18. The system shall track task execution sub-status as a field on the task record: `planning | implementing | blocked | failed | null`. Main status stays `todo | in_progress | review | done`. subStatus is a sub-state of `in_progress` — fewer kanban lanes. Tasks with `needsPlan=true` start in `planning` subStatus (agent refines spec, can ask questions). Tasks with `needsPlan=false` go straight to `implementing`. *(source: user request + elicited)*

19. The runner shall receive start/stop/retry commands from the server via WebSocket. **Data flow is push per task group**: `EXECUTION_START_REQUEST` includes the full task list with descriptions, dependencies, and pre-built prompts. The server builds the complete agent prompt (task description + plan content + project context) and sends it with the request — the client just passes it to `claude -p`. *(source: inferred + elicited)*

20. The system shall track `sessionId` on tasks and task groups for Claude session continuity. The system generates its own UUID for `--session-id` before spawning, making it easy to capture and store the correct session ID rather than parsing it from output. *(source: user request)*

21. The runner shall emit execution events to the server via WebSocket (task started, output chunk, task completed/failed, group completed). *(source: inferred)*

22_a. The system shall support **manual retry only** for failed tasks — no automatic retries. Failed tasks stay failed until the user clicks "Retry" in the UI. *(source: elicited)*

22_b. The system shall support **auto-start** as an opt-in per-workspace setting. When enabled: if a task's type is changed to `ai` in a project with worktrees, the system starts a new runner for that task if none is currently running (no manual "Execute" click needed). For milestone-level execution, auto-start is handled by the `/engy:implement-milestone` skill agent itself — the agent decides task ordering and execution, not deterministic runner logic. *(source: spec FR-9.7, adapted)*

### Agent Spawning

22. The system shall spawn agents via `claude -p --output-format stream-json --permission-mode acceptEdits` on host, or `devcontainer exec ... claude -p --output-format stream-json --dangerously-skip-permissions` in containers. The spawner enforces FR #14 (hard validation of permission flags). *(source: v2 architecture + user confirmation)*

23. The system shall write the task prompt to stdin and close it (same pattern as old Engy3 LlmExecutor). *(source: engy3 reference)*

24. The system shall support session management via `--session-id {uuid}` (new task, UUID generated by runner before spawn) and `--resume {sessionId}` (feedback continuation). *(source: v2 architecture + user request on UUID strategy)*

25. The system shall pass `--append-system-prompt` with task context (task description, plan content, project context, memories). *(source: inferred from engy3 ClaudeExecutionManager.buildPrompt)*

26. The system shall require structured completion output via `--json-schema` with a task completion schema: `{ taskCompleted: boolean, summary: string }`. This ensures the runner can programmatically determine success and capture a summary. Same pattern as Engy3's TASK_COMPLETION_SCHEMA (memories field deferred to future milestone). *(source: engy3 reference — user flagged as missing)*

27. The system shall parse stream-json NDJSON output into structured log entries (type, content, timestamp) and store key events in SQLite. *(source: v2 architecture)*

### Questions System

28. The system shall provide an `askQuestion` MCP tool that agents can call during planning. Based on the existing Claude askQuestion tool pattern. The tool writes the question to SQLite (persisted for durability across page refreshes) and signals the agent to exit with `blocked` status. *(source: v2 architecture + user request to base on existing Claude tool)*

29. The system shall surface unanswered questions in the UI as a queue, grouped by task, with task context. Questions are persisted in the database and survive page refresh. *(source: v2 architecture + user request on persistence)*

30. When a question is answered in the UI, the runner spawns a new agent invocation with the answer as context. *(source: v2 architecture)*

31. Blocked tasks don't block the queue — runner skips them and picks up the next pending task. *(source: v2 architecture)*

32. Questions only come from planning, never from implementation. The `askQuestion` MCP tool validates server-side that the task's `subStatus === 'planning'` and rejects calls otherwise. System prompt also instructs implementation agents not to ask questions. *(source: v2 architecture — key design decision)*

### Feedback Loop

33. The diff viewer shall scope diffs to worktree paths. The **server** is responsible for substituting worktree paths when building git operation requests. The diff viewer shall include a **worktree selector dropdown** allowing the user to choose which worktree to review (project-level or any task-group-level worktree). Supports both project-level and task-group-level worktree diffs. *(source: user request)*

34. The diff viewer shall provide a "Send Feedback" action that writes feedback text to the task record in SQLite and notifies the runner. Feedback goes to the async agent, not through the terminal. *(source: user request)*

35. The runner shall detect feedback on a task and resume the agent session with `--resume {sessionId}` and feedback as context. *(source: v2 architecture)*

### Execution UI

36. Task cards shall show an auto-implement indicator icon when `subStatus` is set (planning/implementing/blocked/failed), distinguishing autonomous work from manual. *(source: user request)*

37. Task detail shall include an "Execution" tab with a structured log viewer showing parsed stream-json events (tool calls, text output, errors, timing). *(source: v2 architecture + user request)*

38. Project overview shall show execution status (which task groups are running, current task per group). *(source: inferred)*

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

   * *Implements FR #8, #16, #22_b*

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

### TG2: Schema & Protocol Foundation

Schema migrations, WebSocket protocol additions, and shared types for execution, worktrees, and questions.

**Tasks:**

1. **Add execution columns to tasks table**

   * Add `subStatus text('sub_status')` (nullable, enum: planning/implementing/blocked/failed)

   * Add `sessionId text('session_id')` (nullable)

   * Add `workingDir text('working_dir')` (nullable)

   * Add `feedback text('feedback')` (nullable)

   * Generate migration with `pnpm drizzle-kit generate`

   * Update tRPC task router to accept/return new fields

   * Update MCP updateTask tool schema

   * *Implements FR #18, #20*

2. **Add worktreePaths to projects and task groups**

   * Add `worktreePaths text('worktree_paths', { mode: 'json' }).$type<Record<string, string>>()` to projects table (project-level worktrees per `context/worktrees.md`)

   * Add `worktreePaths text('worktree_paths', { mode: 'json' }).$type<Record<string, string>>()` to taskGroups table (task-group-level worktrees)

   * Add `sessionId text('session_id')` to taskGroups (tracks which session ran the group)

   * Generate migration

   * Update tRPC task-group and project routers

   * *Implements FR #2, #5, #20*

3. **Create questions table**

   * New table: `questions` (id, taskId, sessionId, question, answer, createdAt, answeredAt)

   * Foreign key to tasks

   * Generate migration — questions persisted in DB for durability across page refreshes

   * *Implements FR #28, #29*

4. **Update agentSessions table and create execution_logs table**

   * **Update existing `agentSessions` table** — add `taskId` FK (nullable, for task-level session tracking), add `executionMode` text (nullable, enum: group/task/milestone), add `completionSummary` text (nullable). Reuse existing sessionId/taskGroupId/state/status fields for runner session tracking.

   * **New table**: `execution_logs` (id, taskId, sessionId, eventType, content, timestamp)

   * Index on taskId + timestamp for efficient querying

   * Generate migration

   * *Implements FR #20, #27*

5. **Add execution and worktree WebSocket protocol messages**

   * Worktree: `GIT_WORKTREE_ADD_REQUEST/RESPONSE`, `GIT_WORKTREE_REMOVE_REQUEST/RESPONSE`

   * Execution: `EXECUTION_START_REQUEST` (includes full task list with pre-built prompts, deps, config), `EXECUTION_STOP_REQUEST`, `EXECUTION_STATUS_EVENT`, `EXECUTION_OUTPUT_EVENT`, `EXECUTION_COMPLETE_EVENT`

   * Add to WsMessage, ClientToServerMessage, ServerToClientMessage unions

   * *Implements FR #7, #19, #21*

6. **Add server-side WebSocket dispatch for new message types**

   * Add pending maps to AppState: `pendingGitWorktreeAdd`, `pendingGitWorktreeRemove`

   * Add dispatch functions following existing `dispatchGitOp` pattern

   * Add response handlers in `handleMessage` switch

   * Add to `rejectAllPending`

   * *Implements FR #7, #19*

### TG3: Git Worktree Management

Two-level worktree model: project-level (from `context/worktrees.md`) and task-group-level (branched from project worktree). Client daemon operations, server dispatch, path resolution helpers.

**Tasks:**

1. **Add worktree git operations to client daemon**

   * `client/src/git/index.ts`: add `addWorktree(repoDir, worktreePath, branch)`, `removeWorktree(repoDir, worktreePath)`, `listWorktrees(repoDir)`

   * Use `execFileAsync('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, worktreePath])`

   * Remove: `git worktree remove {path}` then `git branch -d {branch}`

   * Tests in `client/src/git/index.test.ts`

   * *Implements FR #1, #4*

2. **Handle worktree WS messages in client daemon**

   * `client/src/ws/client.ts`: add cases for `GIT_WORKTREE_ADD_REQUEST` and `GIT_WORKTREE_REMOVE_REQUEST`

   * Same pattern as existing `handleGitStatusRequest` etc.

   * Tests in `client/src/ws/client.test.ts`

   * *Implements FR #7*

3. **Add project-level worktree support to project router**

   * Per `context/worktrees.md` — full implementation:

   * `effectiveWorkspace()`: rewrites docsDir through worktree when docsDir is inside a repo with a worktree

   * `effectiveRepos()`: replaces repo paths with worktree paths

   * `project.create`: accept `createWorktree` boolean, create worktrees for all repos at `{repo}/.claude/worktrees/{project-slug}`

   * `project.addWorktree`: retroactive worktree creation for existing projects

   * `project.getBySlug`: return worktreePaths and effectiveRepos

   * Update all spec file procedures (12+) to use `effectiveWorkspace()`

   * Compensating action on failure: delete DB row + cleanup created worktrees

   * *Implements FR #2, #6*

4. **Add task-group-level worktree management**

   * `web/src/server/trpc/routers/task-group.ts`: add `createWorktrees` mutation

   * Creates worktrees branched from project worktree (not main): `{repo}/.claude/worktrees/{project-slug}/{group-slug}`, branch `{project-slug}/{group-name}`

   * Add `removeWorktrees` mutation (cleanup on group completion)

   * Return `worktreePaths` and `effectiveRepos` in group queries

   * Compensating action: if any worktree fails, clean up already-created ones

   * *Implements FR #3, #4, #5, #6*

5. **Scope diff viewer to worktree paths**

   * `web/src/server/trpc/routers/diff.ts`: **server is responsible** for path substitution — existing git operations already accept `repoDir`, the diff router resolves worktree paths from the project/task-group record and passes the worktree path instead of the repo path

   * Frontend: add a **worktree selector dropdown** to the diff viewer allowing the user to choose which worktree to review (project-level worktree, or any active task-group worktree). Default to the most recently active task-group worktree.

   * Support both project-level and task-group-level worktree diffs

   * *Implements FR #33*

6. **Update frontend to use effective repos**

   * `web/src/components/projects/create-project-dialog.tsx`: add "Create git worktree" checkbox (only when workspace has repos)

   * `web/src/components/projects/project-overview.tsx`: "Create Worktree" button for existing projects without worktrees

   * `web/src/components/projects/task-quick-actions.tsx`: use `project?.effectiveRepos`

   * `web/src/components/projects/milestone-quick-actions.tsx`: use effectiveRepos + add "Implement in Container" action that calls `execution.startMilestoneExecution` instead of opening a local terminal

   * `web/src/components/terminal/use-terminal-scope.ts`: use `project?.effectiveRepos`

   * *Implements FR #2, #6*

### TG4: Runner Loop & Agent Spawning

The core execution engine on the client daemon. A for loop, a spawn, a database write.

**Tasks:**

1. **Create stream-json parser**

   * `client/src/runner/stream-parser.ts`: parses NDJSON lines from `--output-format stream-json`

   * Emits typed events: `init`, `assistant_text`, `tool_use`, `tool_result`, `result_success`, `result_error`

   * Extracts key fields: session_id from init, text content from assistant messages, tool names/inputs from tool_use

   * Unit tests with sample stream-json fixtures

   * *Implements FR #27*

2. **Create agent spawner**

   * `client/src/runner/agent-spawner.ts`: AgentSpawner class

   * `spawn(config: SpawnConfig): Promise<SpawnResult>` — spawns `claude -p` process

   * Host mode: `spawn('claude', ['-p', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`

   * Container mode: `containerManager.exec(workspaceFolder, 'claude', ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`

   * **Hard validation**: assert containerMode === true before allowing `--dangerously-skip-permissions`. Throw if this flag would be used on host.

   * Writes prompt to stdin, closes stdin

   * Pipes stdout through stream parser, emits events

   * Generates UUID for `--session-id` before spawn (stored on task record, making it easy to capture and resume)

   * Supports `--resume {sessionId}` for feedback continuation

   * Supports `--append-system-prompt` for task context injection

   * Parses structured completion output from `--json-schema` (taskCompleted, summary)

   * Timeout with SIGTERM → SIGKILL (same pattern as engy3 LlmExecutor)

   * Returns: `{ sessionId, exitCode, success, output, completion: { taskCompleted, summary } }`

   * TASK_COMPLETION_SCHEMA: `{ taskCompleted: boolean, summary: string }`

   * Unit tests

   * *Implements FR #14, #22, #23, #24, #25, #26*

3. **Create runner loop**

   * `client/src/runner/index.ts`: Runner class

   * `startGroup(groupId, tasks, config)`: creates task-group worktrees, then processes `type: 'ai'` tasks (skips `type: 'human'`). Tasks with `needsPlan=true` start in `planning` subStatus, `needsPlan=false` go straight to `implementing`.

   * **Sequential mode** (concurrency=1): for each task: set subStatus, spawn agent with server-built prompt from EXECUTION_START_REQUEST, on exit update status (done/failed), emit events via WS, advance to next

   * **Parallel mode** (concurrency>1): analyze task dependency graph, spawn up to `maxConcurrency` agents for independent tasks simultaneously, track completions and unblock dependents

   * `startTask(taskId, config)`: single task execution for one-offs. Creates ephemeral worktree branched from project worktree, cleans up after completion.

   * `startMilestone(milestoneRef, prompt, config)`: milestone-level execution — spawns a single agent with the `/engy:implement-milestone` prompt (same prompt the current milestone quick action uses: `Use /engy:implement-milestone for {milestoneRef} in project {projectSlug}`). Runs in dev container when containerEnabled. No per-task tracking — single long-running agent handles the entire milestone.

   * `stop()`: kills current agent process(es), preserves worktree

   * `retry(taskId)`: re-spawn agent for failed task (manual only, no automatic retries)

   * **Auto-start** (opt-in workspace setting): when a task's type changes to `ai` in a project with worktrees, starts a new runner for that task if none is running. Listens for task update events via WS.

   * Skips blocked tasks (questions unanswered) and human tasks, moves to next

   * Emits typed WS events: EXECUTION_STATUS_EVENT, EXECUTION_OUTPUT_EVENT, EXECUTION_COMPLETE_EVENT

   * Reports stream-json log entries to server for storage

   * Stores structured completion output (summary) on task record

   * *Implements FR #15, #16, #17, #18, #20, #21, #22_a, #22_b, #31*

4. **Wire runner to client daemon WS handler**

   * `client/src/ws/client.ts`: handle `EXECUTION_START_REQUEST` → delegates to Runner.startGroup or Runner.startTask

   * Handle `EXECUTION_STOP_REQUEST` → delegates to Runner.stop

   * Runner events flow back through WS to server

   * *Implements FR #19*

5. **Create execution tRPC router**

   * `web/src/server/trpc/routers/execution.ts`:

   * `startGroupExecution(groupId)` — builds prompts for all tasks (task desc + plan content + project context), dispatches EXECUTION_START_REQUEST with full task data to daemon

   * `startTaskExecution(taskId)` — builds prompt, dispatches for single task

   * `startMilestoneExecution(milestoneRef)` — builds the same prompt as the current milestone quick action (`Use /engy:implement-milestone for {milestoneRef} in project {projectSlug}` + add-dir flags), dispatches to daemon for single-agent execution in dev container

   * `stopExecution(groupId)` — dispatches stop

   * `retryTask(taskId)` — dispatches retry with feedback context

   * `getExecutionLogs(taskId, { limit, offset })` — queries execution_logs table

   * `getExecutionStatus(groupId)` — current runner state

   * Wire to app router

   * Tests

   * *Implements FR #15, #17, #27*

6. **Server-side execution event handling**

   * `web/src/server/ws/server.ts`: when receiving EXECUTION_STATUS_EVENT, update task subStatus in SQLite

   * When receiving EXECUTION_OUTPUT_EVENT, insert into execution_logs table

   * When receiving EXECUTION_COMPLETE_EVENT, update task status (done/failed), clear subStatus, store completion data

   * Broadcast status changes to UI via SSE/polling (tRPC invalidation)

   * *Implements FR #21*

### TG5: Questions System & Feedback Loop

Agent-initiated questions during planning, UI queue, feedback from diff viewer.

**Tasks:**

1. **Add askQuestion MCP tool**

   * `web/src/server/mcp/index.ts`: register `askQuestion` tool

   * Based on existing Claude askQuestion tool pattern — input: `{ taskId, question, options?: string[] }`

   * **Server-side validation**: looks up task's `subStatus` and rejects with error if not `planning`. This is the hard gate — MCP tools are global so can't be selectively registered per agent.

   * Writes to questions table (persisted in SQLite for durability across page refreshes), returns `{ status: 'blocked', questionId }`

   * Agent system prompt also instructs: "If you need clarification during planning, call askQuestion and exit."

   * *Implements FR #28, #32*

2. **Create questions tRPC router**

   * `web/src/server/trpc/routers/question.ts`:

   * `list({ taskId?, unanswered? })` — list questions, optionally filtered

   * `answer({ questionId, answer })` — writes answer, updates task subStatus from blocked to null, notifies runner

   * `get(questionId)` — single question with task context

   * Tests

   * *Implements FR #29, #30*

3. **Runner integration for questions and feedback**

   * Runner checks for answered questions on blocked tasks each loop iteration

   * When answer found: spawn new agent with answer as context (task description + "Previous question: ... Answer: ...")

   * When feedback found on a task: spawn agent with `--resume {sessionId}` and feedback text as the prompt

   * Clear feedback field after spawning

   * *Implements FR #30, #35*

4. **Add feedback sender to diff viewer**

   * `web/src/components/diff/feedback-sender.tsx`: text input + "Send Feedback" button

   * Writes feedback to task record via `task.update({ feedback: text })`

   * Feedback goes to the async agent, not through the terminal

   * Show when viewing diffs for a task group with active execution

   * *Implements FR #34*

5. **Create question queue UI**

   * `web/src/components/questions/question-queue.tsx`: list of unanswered questions grouped by task

   * Each question shows: task title, question text, answer input, submit button

   * Show on project overview or as a notification-triggered panel

   * Badge count in header for unanswered questions

   * Questions persist across page refresh (backed by SQLite)

   * *Implements FR #29*

### TG6: Execution UI

Task-level execution indicators, structured log viewer, project-level status.

**Tasks:**

1. **Add auto-implement indicator to task cards**

   * Modify task card components across all views (kanban, eisenhower, dependency graph)

   * When `subStatus` is set: show icon (spinner for implementing, pause for blocked, alert for failed, brain for planning)

   * Distinguish from manual in_progress (no subStatus = manual work)

   * *Implements FR #36*

2. **Create execution tab in task detail**

   * `web/src/components/tasks/execution-tab.tsx`: structured log viewer

   * Queries `execution.getExecutionLogs(taskId)` with auto-refresh

   * Renders log entries by type: tool calls (collapsible with input/output), text output, errors (highlighted), timing info

   * Session ID display, duration, status, structured completion summary

   * "Retry" button for failed tasks, "Stop" button for running tasks

   * *Implements FR #37*

3. **Add execution status to project overview**

   * Show which task groups are currently executing

   * Current task per group with subStatus

   * Container status if containers enabled

   * Quick actions: start group, stop group, open container terminal

   * *Implements FR #38*

4. **Update MCP to expose worktree and execution data**

   * `getProjectDetails`: include `worktreePaths` and computed `effectiveRepos`

   * Use `effectiveWorkspace()` when computing `projectDir` and `specDir` paths

   * Return execution status for active task groups

   * *Implements FR #2, #6*

5. **Run /engy:review, pnpm blt, test in Chrome**

   * Final validation task

   * *Implements verification*

## Test Scenarios

### Two-Level Worktree Lifecycle

```text
Given a project "my-project" in a workspace with repos ["/path/to/repo"]
When the user creates the project with createWorktree=true
Then a project worktree is created at "{repo}/.claude/worktrees/my-project"
And worktreePaths is stored on the project record
And spec files resolve through the project worktree

When the user starts execution on task group "backend-api"
Then a task-group worktree is created at "{repo}/.claude/worktrees/my-project/backend-api"
And the branch is named "my-project/backend-api" (per spec FR-6.1)
And the task-group worktree is branched from the project worktree (not main)
And diffs show changes in the task-group worktree

When all tasks complete and the group is stopped
Then the task-group worktree is removed
But the project worktree persists
```

### Agent Execution (Host Mode)

```text
Given a task with status "todo" and type "ai" in a task group
And containers are disabled on the workspace
When the runner picks up this task
Then it generates a UUID and sets sessionId on the task record
And sets status to "in_progress" and subStatus to "implementing"
And spawns: claude -p --output-format stream-json --permission-mode acceptEdits --session-id {uuid} --json-schema {TASK_COMPLETION_SCHEMA}
And does NOT use --dangerously-skip-permissions (hard validation)
And writes task prompt to stdin
And parses stream-json events into execution_logs
When the agent exits with code 0 and structured output { taskCompleted: true, summary: "..." }
Then task status is set to "done" and subStatus is cleared
And completion summary is stored on the task record
And runner advances to next ai task (skips human tasks)
```

### Agent Execution (Container Mode)

```text
Given a task in a workspace with containerEnabled=true
When the runner picks up this task
Then it ensures the container is running (devcontainer up if needed)
And spawns: devcontainer exec ... claude -p --output-format stream-json --dangerously-skip-permissions --json-schema {TASK_COMPLETION_SCHEMA}
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

```text
Given a task with subStatus "planning"
When the agent calls askQuestion MCP tool with "What authentication method?"
Then a question record is created in SQLite (persisted across refresh)
And the task subStatus is set to "blocked"
And the agent process exits
And the runner skips this task and moves to next

When the user answers "Use JWT tokens" in the question queue UI
Then the question record is updated with the answer
And the task subStatus is cleared from "blocked"
And on next loop iteration, the runner spawns a new agent with the answer as context
```

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
Given a project with worktrees and a task not in any task group
When the user clicks "Execute" on the individual task
Then an ephemeral worktree is created branched from the project worktree
And the agent runs in the ephemeral worktree
When the task completes
Then the ephemeral worktree is cleaned up
```

### Planning Phase (needsPlan)

```text
Given a task with needsPlan=true and type "ai"
When the runner picks up this task
Then it sets subStatus to "planning" (not "implementing")
And spawns a planning agent with askQuestion MCP tool registered
When the agent calls askQuestion with "Which database should I use?"
Then the task becomes blocked
And the runner moves to the next task

Given a task with needsPlan=false and type "ai"
When the runner picks up this task
Then it sets subStatus to "implementing" directly
And spawns an implementation agent without askQuestion tool
```

### Auto-Start (Single Task)

```text
Given a workspace with autoStart enabled and a project with worktrees
And a task with type "human" and no runner currently active
When the user changes the task type to "ai"
Then the system starts a new runner for this task
And creates an ephemeral worktree branched from the project worktree
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

1. **Spawn per task, not long-running.** No idle detection, no wasted compute. Agent comes in, does the work, leaves.

2. **Planning is collaborative, execution is autonomous.** Clear boundary at the task spec.

3. **Questions only in planning, never in implementation.** Spec should be detailed enough.

4. **Container is the sandbox.** `--dangerously-skip-permissions` ONLY in containers (hard validated). Firewall + bind mount is the boundary.

5. **Logs from stream-json, not xterm.** Agent runs headless via `-p`. UI parses the JSON stream for progress.

6. **Abstract later, not now.** Build on `claude -p`, extract AgentRuntime interface when coupling friction appears.

7. **Blocked tasks don't block the queue.** Runner skips them, parallel progress across the group.

8. **subStatus is a sub-state of in_progress.** Fewer kanban lanes, richer task card indicators.

9. **UUID session-id set by runner.** Generate before spawn, store immediately. No parsing from output.

10. **Structured completion via --json-schema.** Runner gets programmatic success signal + summary from every agent invocation.

11. **Two-level worktrees.** Project worktree isolates spec files and provides the base branch. Task-group worktrees branch from the project worktree for implementation isolation.

12. **Dev containers first (TG1).** Enables manual task execution in containers immediately, before the runner is built.

13. **One container per workspace.** Shared across all task groups. Cheaper, faster. Agent isolation is via worktrees, not containers. Torn down on idle timeout (idle = no running task agents AND no connected container terminals).

14. **Push data model.** Server builds prompts and sends full task data with EXECUTION_START_REQUEST. Client is a dumb executor — just passes prompts to `claude -p`.

15. **needsPlan drives planning phase.** Tasks with `needsPlan=true` get a planning agent spawn first (can ask questions). Tasks with `needsPlan=false` go straight to implementation.

16. **Mount ~/.claude in containers.** OAuth tokens, global config, and state data persist. Same auth mechanism as host.

17. **Manual retry only.** No automatic retries. Failed tasks stay failed until user clicks Retry. Keeps the user in control.

18. **Auto-start is opt-in, skill-driven for milestones.** When the workspace `autoStart` setting is enabled, individual tasks auto-start a runner when their type changes to `ai` (requires project worktrees). Milestone execution is delegated to the `/engy:implement-milestone` skill agent, which handles task ordering and execution autonomously rather than deterministic runner logic.

19. **Reuse agentSessions table.** Extend the existing agentSessions table with taskId, executionMode, and completionSummary rather than creating a parallel session tracking mechanism.
