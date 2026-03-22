---
title: Execution Engine
status: planning
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

## Task Group Sequencing

- **TG1: Dev Container Infrastructure** — no dependencies. Can start immediately. Provides optional container sandbox that TG2's agent spawner routes through.
- **TG2: Runner Loop & Agent Spawning** — depends on TG1 (agent spawner needs ContainerManager for container-mode execution, terminal routing for worktree sessions).
- **TG3: Execution UI** — depends on TG2 (execution tab, status indicators, and project overview all read session/execution state produced by the runner).
- **TG4: Questions System & Feedback Loop** — depends on TG2 (runner integration for question-blocked tasks and feedback-triggered resume). Can be parallelized with TG3 since they touch different files.

## TG1: Dev Container Infrastructure

`@devcontainers/cli` integration on the client daemon, workspace settings UI, terminal into containers. This is TG1 so the user can immediately start executing tasks manually in dev containers before the runner exists.

### Requirements

1. The system shall support optional per-workspace Docker containers enabled via workspace settings (`containerEnabled`, `allowedDomains`, `extraPackages`, `envVars`, `idleTimeout`). *(source: v2 architecture)* (FR-TG1.1)
2. The system shall manage one container per workspace via `@devcontainers/cli`: `devcontainer up` on first use (or when task group starts), `devcontainer exec` for running agents, tear down after configurable idle timeout when idle. Idle = no running task agents AND no connected container terminals. Shared across all task groups in the workspace. *(source: v2 architecture + elicited)* (FR-TG1.2)
3. The system shall provide a base `.devcontainer/devcontainer.json` in the workspace docsDir using Anthropic's reference config (`ghcr.io/anthropics/devcontainer-features/claude-code:1`), with network firewall (default-deny, whitelist npm/GitHub/Claude API + workspace additions). All workspace repos and project dirs (any `--add-dir` paths passed to claude) are bind-mounted into the container. Host `~/.claude` directory is bind-mounted for OAuth tokens, global config, and state data persistence. See `context/anthropic-devcontainer-reference.md` for exact Anthropic reference files (devcontainer.json, Dockerfile, init-firewall.sh) and Engy adaptation notes. *(source: v2 architecture + elicited)* (FR-TG1.3)
4. The system shall rewrite `localhost` URLs to `host.docker.internal` equivalents in container environment variables. Following the pattern from Anthropic's reference config (which allows host network access via `HOST_NETWORK` in the firewall), any host-local URLs (e.g., `ENGY_SERVER_URL=http://localhost:3000`) must be rewritten to `http://host.docker.internal:3000` when passed as `containerEnv` or `remoteEnv` to `devcontainer exec`. *(source: Anthropic reference config host network pattern + user request)* (FR-TG1.4)
5. The system shall fall back to direct host execution when containers are disabled. *(source: v2 architecture)* (FR-TG1.5)
6. The system shall support opening a full xterm terminal into a running container with the same persistence, reconnect, and circular buffer capabilities as local terminals. Container terminals use `devcontainer exec --workspace-folder {path} /bin/bash` instead of local `pty.spawn`, but all xterm features (resize, kill, reconnect with buffer replay) remain. *(source: user request)* (FR-TG1.6)
7. When containers are enabled, ALL Claude-related execution runs in containers — not just orchestrated agent spawns. This includes: (a) runner-spawned task agents, (b) one-off task execution from the UI, (c) all terminals opened from the terminal panel on the right side of the UI, (d) background processes spawned by Claude. Any xterm session or Claude invocation, whether initiated by the runner or manually via the UI, must route through `devcontainer exec` when `containerEnabled=true` on the workspace. *(source: v2 architecture + user request)* (FR-TG1.7)
8. The system shall NEVER allow `--dangerously-skip-permissions` to be used outside of a container. The agent spawner must validate that this flag is only passed when executing via `devcontainer exec`. If containerEnabled is false on the workspace, the flag must not be used regardless of any other configuration. *(source: user request — safety critical)* (FR-TG1.8)

### Tasks

1. **Add container config and execution settings to workspaces schema**
   - Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/trpc/routers/workspace.ts` [MODIFY]
   - Implements FR-TG1.1
   - Add `containerEnabled integer('container_enabled', { mode: 'boolean' }).default(false)` to workspaces. Add `containerConfig text('container_config', { mode: 'json' }).$type<ContainerConfig>()` to workspaces (allowedDomains, extraPackages, envVars, idleTimeout). Add `maxConcurrency integer('max_concurrency').default(1)` to workspaces (controls parallel task execution within groups). Add `autoStart integer('auto_start', { mode: 'boolean' }).default(false)` to workspaces (auto-start runner when tasks marked as AI). Generate migration. Update tRPC workspace router to accept/return new fields.

2. **Add container WebSocket protocol messages**
   - Files: `common/src/ws/protocol.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY], `web/src/server/trpc/context.ts` [MODIFY]
   - Implements FR-TG1.2
   - Add `CONTAINER_UP_REQUEST/RESPONSE`, `CONTAINER_STATUS_REQUEST/RESPONSE`, `CONTAINER_DOWN_REQUEST/RESPONSE` to WsMessage, ClientToServerMessage, ServerToClientMessage unions. Add pending maps to AppState: `pendingContainerUp`, `pendingContainerDown`, `pendingContainerStatus`. Add dispatch functions and response handlers following existing `dispatchGitOp` pattern.

3. **Create container manager on client daemon** (depends on task 2)
   - Files: `client/src/container/manager.ts` [NEW]
   - Implements FR-TG1.2
   - `ContainerManager` class with `up(workspaceFolder, config)` (runs `devcontainer up --workspace-folder {path}`, returns container ID), `exec(workspaceFolder, command, args, env)` (runs `devcontainer exec --workspace-folder {path} --remote-env KEY=VALUE ... {command} {args}`), `down(workspaceFolder)` (stops container), `status(workspaceFolder)` (checks if running). Uses `child_process.spawn` with JSON output parsing. Bind-mount host `~/.claude` into container for OAuth tokens, global config, and state data.

4. **Handle container WS messages in client daemon** (depends on tasks 2, 3)
   - Files: `client/src/ws/client.ts` [MODIFY]
   - Implements FR-TG1.2
   - Add cases for `CONTAINER_UP_REQUEST`, `CONTAINER_DOWN_REQUEST`, `CONTAINER_STATUS_REQUEST`. Delegates to ContainerManager.

5. **Generate devcontainer config for workspace**
   - Files: `client/src/container/config-generator.ts` [NEW]
   - Implements FR-TG1.3, FR-TG1.4
   - Generates `.devcontainer/devcontainer.json` in workspace docsDir (one per workspace, not per repo). Uses Anthropic reference config as base: `ghcr.io/anthropics/devcontainer-features/claude-code:1`. Adds `init-firewall.sh` with default-deny + allowlist (npm, GitHub, Claude API + workspace custom domains). Bind-mounts all workspace repos and project dirs at their original paths. Bind-mounts host `~/.claude` for OAuth tokens, global config, and state data. Rewrites `localhost` URLs to `host.docker.internal` in `containerEnv`. Triggered on first container start if `.devcontainer/` doesn't exist.

6. **Route all terminals through container when enabled** (depends on task 3)
   - Files: `common/src/ws/protocol.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY]
   - Implements FR-TG1.6, FR-TG1.7
   - Extend `TerminalSpawnCmd` to accept optional `containerWorkspaceFolder` field. When `containerEnabled=true` on the workspace, all terminal spawns (from the terminal panel, background processes, and UI-initiated xterm sessions) automatically route through `devcontainer exec --workspace-folder {path} /bin/bash` instead of local `pty.spawn`. No separate "Open Container Terminal" button needed — all terminals are container terminals when devcontainers are enabled, local terminals when disabled. Full xterm features: persistence via circular buffer, reconnect with buffer replay, resize, kill.

7. **Add container settings to workspace settings UI**
   - Files: `web/src/components/workspace/container-settings.tsx` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.7
   - Toggle containerEnabled, edit allowedDomains list, extraPackages, envVars, idleTimeout. Wire to workspace update tRPC mutation. Add container status indicator (running/stopped) to workspace overview.

**Parallelizable:** Tasks 1, 2, 5 have no dependencies and can run concurrently. Tasks 3, 4, 6 depend on task 2 (protocol messages). Task 7 depends on task 1 (schema fields).

### Completion Summary

{Leave blank until done.}

## TG2: Runner Loop & Agent Spawning

The core execution engine on the client daemon. A for loop, a spawn, a database write. Includes execution schema, protocol, worktree management, and the "Execute in Background" UI actions that trigger it.

### Requirements

1. The system shall create per-session worktrees from local main when execution starts. Path: `{repo}/.claude/worktrees/{session-branch}`. The runner creates worktrees directly (no WS protocol needed — runner runs on the client daemon). *(source: user request, simplified from context/worktrees.md)* (FR-TG2.1)
2. The system shall store `worktreePath` on the `agentSessions` table. The diff viewer and execution UI use this to locate diffs and session files. *(source: user request)* (FR-TG2.2)
3. The system shall retain worktrees after a session completes — worktrees are needed for diff review, feedback loops, and eventually PR creation (future milestone). Cleanup is deferred to the PR/merge milestone where worktrees are removed after the PR is merged. *(source: inferred — worktree lifecycle spans beyond execution)* (FR-TG2.3)
4. For task groups, all tasks share one worktree/session. For individual tasks, each gets its own ephemeral worktree. *(source: user request)* (FR-TG2.4)
5. The system shall provide an "Execute in Background" action in the quick action dropdowns for tasks, task groups, and milestones. This triggers headless execution via the runner instead of opening a terminal. The action shall be available alongside the existing "Implement" terminal action. When a session is active, the quick action button shows a running/completed status indicator. *(source: user request)* (FR-TG2.5)
6. The system shall provide a runner on the client daemon that: creates a worktree from local main, spawns an agent with the same prompt and flags that existing quick actions build, waits for exit, reports status. The agent itself handles task orchestration — the runner is just a headless version of clicking "Implement" in the UI. *(source: v2 architecture, simplified — agent is the orchestrator)* (FR-TG2.6)
7. The runner shall receive start/stop commands from the server via WebSocket. The server sends `EXECUTION_START_REQUEST` with the pre-built prompt and flags (same as quick actions: `--append-system-prompt` with project context, `--add-dir` for repos). The runner creates a worktree, spawns the agent, and reports back. *(source: inferred + elicited)* (FR-TG2.7)
8. The system shall track `sessionId` on the session record. The system generates its own UUID for `--session-id` before spawning. *(source: user request)* (FR-TG2.8)
9. The runner shall emit execution status events to the server via WebSocket (session started, session completed/failed). Execution output is NOT streamed — Claude writes session files to `~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`, readable from host via bind mount. *(source: inferred, simplified)* (FR-TG2.9)
10. The system shall spawn agents via `claude -p --output-format stream-json --permission-mode acceptEdits` on host, or `devcontainer exec ... claude -p --output-format stream-json --dangerously-skip-permissions` in containers. The spawner enforces FR-TG1.8 (hard validation of permission flags). *(source: v2 architecture + user confirmation)* (FR-TG2.10)
11. The system shall write the quick-action-built prompt to stdin and close it. *(source: engy3 reference)* (FR-TG2.11)
12. The system shall support session management via `--session-id {uuid}` (new session) and `--resume {sessionId}` (retry/feedback continuation). *(source: v2 architecture)* (FR-TG2.12)
13. The system shall require structured completion output via `--json-schema` with a task completion schema: `{ taskCompleted: boolean, summary: string }`. *(source: engy3 reference)* (FR-TG2.13)
14. Execution output is stored in Claude's native session files (`~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`). The UI reads these directly — no SQLite storage. *(source: engy3 reference, simplified)* (FR-TG2.14)
15. The system shall support manual retry only — failed sessions stay failed until user clicks "Retry". *(source: elicited)* (FR-TG2.15)
16. The system shall support auto-start as an opt-in per-workspace setting. When a task's type changes to `ai`, starts a runner if none is running. *(source: spec FR-9.7, adapted)* (FR-TG2.16)
17. The diff viewer shall scope diffs to session worktree paths. The server looks up `worktreePath` from the session record and passes it as `repoDir` to existing git diff operations. The diff viewer shall include a session selector dropdown listing active and recent sessions. *(source: user request)* (FR-TG2.17)

### Tasks

1. **Add execution schema and WebSocket protocol**
   - Files: `web/src/server/db/schema.ts` [MODIFY], `common/src/ws/protocol.ts` [MODIFY], `web/src/server/trpc/routers/task.ts` [MODIFY], `web/src/server/mcp/index.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY], `web/src/server/trpc/context.ts` [MODIFY]
   - Implements FR-TG2.7, FR-TG2.8, FR-TG2.9
   - Add to tasks table: `subStatus text('sub_status')` (nullable, enum: planning/implementing/blocked/failed), `sessionId text('session_id')` (nullable), `feedback text('feedback')` (nullable). Update existing `agentSessions` table — add `taskId` FK (nullable), `executionMode` text (nullable, enum: group/task/milestone), `completionSummary` text (nullable), `worktreePath text('worktree_path')` (nullable). Generate migration. Update tRPC task router to accept/return subStatus, sessionId, feedback. Update MCP updateTask tool schema. Add WS protocol messages: `EXECUTION_START_REQUEST` (pre-built prompt + flags), `EXECUTION_STOP_REQUEST`, `EXECUTION_STATUS_EVENT` (session started), `EXECUTION_COMPLETE_EVENT` (session done/failed). Add dispatch functions and pending maps for execution messages following existing patterns.

2. **Create agent spawner** (depends on task 1)
   - Files: `client/src/runner/agent-spawner.ts` [NEW]
   - Implements FR-TG2.10, FR-TG2.11, FR-TG2.12, FR-TG2.13, FR-TG1.8
   - AgentSpawner class with `spawn(config: SpawnConfig): Promise<SpawnResult>`. Host mode: `spawn('claude', ['-p', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`. Container mode: `containerManager.exec(workspaceFolder, 'claude', ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--json-schema', TASK_COMPLETION_SCHEMA, ...args])`. Hard validation: assert containerMode === true before allowing `--dangerously-skip-permissions`. Throw if this flag would be used on host. Receives pre-built prompt, flags, and system prompt from the execution router (same as quick actions). Writes prompt to stdin, closes stdin. Monitors stdout for structured completion output. Generates UUID for `--session-id` before spawn (stored on session record). Supports `--resume {sessionId}` for retry/feedback continuation. Timeout with SIGTERM then SIGKILL. Returns: `{ sessionId, exitCode, success, completion: { taskCompleted, summary } }`. TASK_COMPLETION_SCHEMA: `{ taskCompleted: boolean, summary: string }`. Unit tests.

3. **Create runner** (depends on task 2)
   - Files: `client/src/runner/index.ts` [NEW]
   - Implements FR-TG2.1, FR-TG2.2, FR-TG2.3, FR-TG2.4, FR-TG2.6, FR-TG2.9, FR-TG2.15, FR-TG2.16
   - Runner class — a thin wrapper around the agent spawner that manages worktree lifecycle and WS communication. The agent itself handles task orchestration. `start(prompt, flags, config)`: creates worktree from local main, creates session record with `worktreePath`, spawns agent with the pre-built prompt. Worktrees are retained after completion (needed for diff review, feedback, future PR creation). `stop()`: kills current agent process, preserves worktree. `retry(sessionId)`: re-spawn agent with `--resume {sessionId}` in the same worktree. Emits typed WS events: EXECUTION_STATUS_EVENT, EXECUTION_COMPLETE_EVENT. Stores structured completion output (summary) on session record.

4. **Wire runner to client daemon WS handler** (depends on task 3)
   - Files: `client/src/ws/client.ts` [MODIFY]
   - Implements FR-TG2.7
   - Handle `EXECUTION_START_REQUEST` — delegates to Runner.start. Handle `EXECUTION_STOP_REQUEST` — delegates to Runner.stop. Runner events flow back through WS to server.

5. **Create execution tRPC router** (depends on task 1)
   - Files: `web/src/server/trpc/routers/execution.ts` [NEW]
   - Implements FR-TG2.6, FR-TG2.14
   - `startExecution({ scope, id })` — builds the same prompt and flags that the corresponding quick action uses (task, task group, milestone). Reuses `buildClaudeCommand` logic with `--append-system-prompt` + `--add-dir` flags. Dispatches EXECUTION_START_REQUEST with prompt + config to daemon. `stopExecution(sessionId)` — dispatches stop. `retryExecution(sessionId)` — dispatches retry (resume in same worktree). `getSessionFile(sessionId)` — resolves session file path from `~/.claude/projects/{encoded-worktree-path}/{sessionId}.jsonl`, reads and returns content for execution log viewer. `getActiveSessions({ projectId? })` — lists active/recent sessions with worktree paths (for terminal scope and diff viewer). Wire to app router. Tests.

6. **Server-side execution event handling** (depends on task 1)
   - Files: `web/src/server/ws/server.ts` [MODIFY]
   - Implements FR-TG2.9
   - When receiving EXECUTION_STATUS_EVENT, update session state in SQLite. When receiving EXECUTION_COMPLETE_EVENT, update session status (done/failed), store completion summary on session record. Broadcast status changes to UI via tRPC invalidation. No output event handling — execution logs live in Claude's session files, read directly by the UI.

7. **Scope diff viewer to session worktree paths** (depends on task 5)
   - Files: `web/src/server/trpc/routers/diff.ts` [MODIFY], `web/src/components/diff/review-actions.tsx` [MODIFY]
   - Implements FR-TG2.17
   - Look up the active session's `worktreePath` for the given task/task-group and pass it as `repoDir` to existing git diff operations. Frontend: add a session selector dropdown to the diff viewer — lists active and recent sessions with their worktree paths. Default to the most recent active session. Enables reviewing agent diffs while execution is in progress.

8. **Add worktree sessions to terminal scope** (depends on task 5)
   - Files: `web/src/components/tasks/execution-tab.tsx` [MODIFY]
   - Implements FR-TG2.2
   - Extend the terminal dock's "New Terminal" dropdown to show active session worktrees alongside workspace repos. Group under a "Worktrees" section — each entry shows session branch name and target repo. Clicking opens a terminal `cd`'d into the worktree path (routes through container when `containerEnabled`). Uses existing terminal scope infrastructure (`use-terminal-scope.ts`) — add a worktree scope type that reads `worktreePath` from active sessions via a new `execution.getActiveSessions()` query.

9. **Add "Execute" action to quick action dropdowns** (depends on task 5)
   - Files: `web/src/components/projects/task-quick-actions.tsx` [MODIFY], `web/src/components/projects/milestone-quick-actions.tsx` [MODIFY], `web/src/components/projects/milestone-list.tsx` [MODIFY]
   - Implements FR-TG2.5
   - Add "Execute in Background" to the existing 3-dot dropdown alongside "Implement" in task-quick-actions. Calls `execution.startExecution({ scope: 'task', id: taskId })`. Add "Execute Milestone" to milestone-quick-actions dropdown. Add "Execute Task Group" to TaskGroupQuickAction in milestone-list. Show running/completed status indicator on the quick action button when a session is active for that scope.

**Parallelizable:** Tasks 1, 5, 6 can begin once TG1 is complete. Tasks 2, 3, 4 are sequential. Tasks 7, 8, 9 depend on task 5 and can run concurrently with each other.

### Completion Summary

{Leave blank until done.}

## TG3: Execution UI

Task-level execution indicators, structured log viewer, project-level status. Now that the runner is working (TG2), the UI needs to show execution state.

### Requirements

1. Task cards shall show an execution indicator when a session is active for that task, distinguishing autonomous work from manual. *(source: user request)* (FR-TG3.1)
2. Task detail shall include an "Execution" tab that reads the Claude session file (JSONL) and renders conversation entries: user prompts, assistant responses, tool calls (collapsible), errors. *(source: v2 architecture + user request)* (FR-TG3.2)
3. Project overview shall show execution status (which sessions are running, per task group). *(source: inferred)* (FR-TG3.3)
4. The `getProjectDetails` MCP tool shall include active session worktree paths and execution status for task groups. *(source: user request)* (FR-TG3.4)

### Tasks

1. **Add auto-implement indicator to task cards**
   - Files: `web/src/components/tasks/task-card.tsx` [MODIFY]
   - Implements FR-TG3.1
   - Task cards already show milestone badge, task group badge, and type indicator. Add a subStatus indicator alongside existing badges. When `subStatus` is set: show icon (spinner for implementing, pause for blocked, alert for failed, brain for planning). Distinguish from manual in_progress (no subStatus = manual work).

2. **Create execution tab in task detail**
   - Files: `web/src/components/tasks/execution-tab.tsx` [NEW]
   - Implements FR-TG3.2
   - Session file viewer. Reads Claude's session file via `execution.getSessionFile(sessionId)` — parses JSONL entries (UserEntry, AssistantEntry, tool calls). Polls for updates only while the execution tab is open — no background file watching. Component mounts to start polling, unmounts to stop. Renders conversation entries: user prompts, assistant responses, tool calls (collapsible with input/output), errors (highlighted). Session ID display, duration, status, structured completion summary. "Retry" button for failed tasks, "Stop" button for running tasks.

3. **Add execution status to project overview**
   - Files: `web/src/components/projects/milestone-list.tsx` [MODIFY]
   - Implements FR-TG3.3
   - Integrate into existing expandable milestone/task group layout (task groups already render with `TaskGroupQuickAction` — extend with execution state). Show which task groups are currently executing, current task per group with subStatus. Container status if containers enabled. Quick actions: start group, stop group, open container terminal (extend existing `TaskGroupQuickAction`).

4. **Update MCP to expose execution data**
   - Files: `web/src/server/mcp/index.ts` [MODIFY]
   - Implements FR-TG3.4
   - `getProjectDetails`: include active session worktree paths and execution status for task groups.

5. **Run /engy:review, pnpm blt, test in Chrome**
   - Final validation task.
   - Implements verification.

**Parallelizable:** Tasks 1, 2, 3, 4 have no dependencies on each other and can run concurrently.

### Completion Summary

{Leave blank until done.}

## TG4: Questions System & Feedback Loop

Agent-initiated questions during planning, UI queue, feedback from diff viewer. Includes questions schema. Enables agents to ask for clarification during execution and devs to send feedback on agent output.

### Requirements

1. The system shall provide an `askQuestion` MCP tool modeled after Claude Code's native `AskUserQuestion` tool. The tool accepts `{ sessionId, taskId?, documentPath?, questions: [{ question, header, multiSelect, options: [{ label, description, preview? }] }] }` — supporting 1-4 batched questions per call, structured options with descriptions, optional markdown previews for visual comparison, and multi-select. `sessionId` (required) identifies the agent session asking; `taskId` (optional) identifies the task being planned; `documentPath` (optional) references the spec/plan doc the agent is reading. The tool writes each question as a separate row to SQLite (persisted for durability across page refreshes). Signals the agent to exit. *(source: v2 architecture + user request to model after Claude Code AskUserQuestion tool)* (FR-TG4.1)
2. The system shall surface unanswered questions via: (a) a bouncing `?` icon on task cards that have unanswered questions — provides at-a-glance visibility without opening the task; (b) a persistent notification badge in the header (count of unanswered questions) that persists until all questions in the group are answered and submitted; (c) a "Questions" tab in the task dialog (alongside Description, Plan, Execution tabs) — shows all questions for that task with inline answering. Clicking the header notification opens a question list with two grouping modes: task-scoped questions grouped by task, and session-scoped questions (no task) grouped by session. Clicking any entry opens a question dialog with tabs: one tab per question (labeled by `header` chip, e.g. "Auth", "ORM") — each tab shows the question text, structured options (label + description), optional preview rendered as HTML via markdown, multi-select support via checkboxes, free-text "Other" input. A Task tab (only when `taskId` is set) — task title and description. A Document tab (when `documentPath` is set) — reuses the existing document editor in read-only mode. Single "Submit All" button in the dialog footer. Questions are persisted in the database and survive page refresh. The runner is only notified after the user submits all answers for a group — partial submissions do not unblock the task or resume the agent. *(source: v2 architecture + user request on persistent notifications, bouncing icon, and questions tab)* (FR-TG4.2)
3. When all questions are answered in the UI, the runner spawns a new agent invocation with `--resume {sessionId}` and answers as context. *(source: v2 architecture)* (FR-TG4.3)
4. Any agent (planning or implementing) can call `askQuestion` — there is no `subStatus` gate. The tool sets the task's `subStatus` to `blocked` regardless of what it was before. *(source: user request — simplified, no phase restriction)* (FR-TG4.4)
5. The diff viewer shall provide a "Send Feedback" action that writes feedback text to the task record in SQLite and notifies the runner. Feedback goes to the async agent, not through the terminal. *(source: user request)* (FR-TG4.5)
6. The runner shall detect feedback and resume the agent session with `--resume {sessionId}` and feedback as context. *(source: v2 architecture)* (FR-TG4.6)

### Tasks

1. **Create questions table**
   - Files: `web/src/server/db/schema.ts` [MODIFY]
   - Implements FR-TG4.1, FR-TG4.2
   - New table: `questions` (id, taskId, sessionId, documentPath, question, header, options JSON, multiSelect, answer, createdAt, answeredAt). `taskId` — nullable FK to tasks (null for session-scoped questions outside task context). `sessionId` — required, identifies the agent session (grouping key for non-task questions). `documentPath` — nullable, path to the spec/plan doc the agent was reading (for UI context tab). `header` — short chip label (max 12 chars) for quick scanning. `options` — JSON array of `{ label, description, preview? }` (structured choices modeled after Claude Code's AskUserQuestion). `multiSelect` — boolean, whether multiple options can be selected. Generate migration with `pnpm drizzle-kit generate`.

2. **Add askQuestion MCP tool** (depends on task 1)
   - Files: `web/src/server/mcp/index.ts` [MODIFY]
   - Implements FR-TG4.1, FR-TG4.4
   - Register `askQuestion` tool modeled after Claude Code's native `AskUserQuestion` tool. Input schema: `{ sessionId: string, taskId?: number, documentPath?: string, questions: [{ question, header, multiSelect, options: [{ label, description, preview? }] }] }`. No subStatus gate — any agent (planning or implementing) can call this tool. Writes one row per question to questions table (persisted in SQLite). If `taskId` is set, sets task `subStatus` to `blocked`. Returns `{ status: 'blocked', questionIds: number[] }`. Agent system prompt instructs: "If you need clarification, call askQuestion with structured options and exit. Batch related questions into a single call (up to 4). Include documentPath so the user can reference the spec."

3. **Create questions tRPC router** (depends on task 1)
   - Files: `web/src/server/trpc/routers/question.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]
   - Implements FR-TG4.2, FR-TG4.3
   - `list({ taskId?, sessionId?, unanswered? })` — list questions, optionally filtered. Returns questions with full options JSON for rendering. `submitAnswers({ answers: [{ questionId, answer }] })` — batch-writes answers (string for single-select/free text, JSON array for multi-select) for all questions in a group. Only unblocks the task (clears `subStatus` from `blocked`) after all questions in the group are answered — partial submissions are rejected. Triggers agent resume: dispatches `EXECUTION_START_REQUEST` with `resumeSessionId` and answers formatted into the prompt (reuses existing execution dispatch pattern from `dispatchExecution` in context). `get(questionId)` — single question with task context (task title, description) and `documentPath` for the Document tab. `unansweredCount({ projectId? })` — returns count for notification badge (counts groups with any unanswered questions, not individual questions). `unansweredByTask({ projectId? })` — returns `taskId → count` map for task card bouncing `?` icons. Wire to app router in `root.ts`. Tests.

4. **Server-side integration for questions and feedback** (depends on tasks 2, 3)
   - Files: `web/src/server/ws/server.ts` [MODIFY], `web/src/server/trpc/routers/execution.ts` [MODIFY]
   - Implements FR-TG4.3, FR-TG4.6
   - **Completion handler** (`handleExecutionCompleteEvent` in ws/server.ts): when agent exits after calling `askQuestion`, the task's `subStatus` is already `blocked`. The handler must check for this — if `subStatus === 'blocked'`, set session to `paused` (not `completed`/`stopped`) and preserve the blocked subStatus. This ensures askQuestion's blocked state survives agent exit. **Feedback resume** (execution.ts): add `sendFeedback({ sessionId, feedback })` mutation — writes feedback to task record, dispatches `EXECUTION_START_REQUEST` with `resumeSessionId` and feedback formatted as the prompt ("Developer feedback on your changes:\n{feedback}\nAddress the feedback and continue."), clears feedback field after dispatch. No runner modifications needed — the existing `EXECUTION_START_REQUEST` handler with `resumeSessionId` calls `runner.retry()` which uses `--resume`.

5. **Add task-record feedback path to diff viewer** (depends on task 4)
   - Files: `web/src/components/diff/review-actions.tsx` [MODIFY]
   - Implements FR-TG4.5
   - Currently `handleSendFeedback()` sends to terminal via `sendToTerminal()`. Extend: detect if the task has an active runner session via `execution.getSessionStatus`. When runner is active, call `execution.sendFeedback({ sessionId, feedback })` instead of `sendToTerminal`. When no runner active, keep existing terminal path. Show feedback target indicator: "Sending to runner agent" vs "Sending to terminal". Use existing `generateDiffFeedback()` for markdown formatting in both paths.

6. **Create question dialog UI** (depends on task 3)
   - Files: `web/src/components/questions/question-list.tsx` [NEW], `web/src/components/questions/question-dialog.tsx` [NEW], `web/src/components/projects/task-card.tsx` [MODIFY], `web/src/components/projects/task-dialog.tsx` [MODIFY], `web/src/components/app-header.tsx` [MODIFY]
   - Implements FR-TG4.2
   - **Bouncing `?` icon on task cards:** Add a bouncing question-mark icon to `task-card.tsx` when the task has unanswered questions. Query unanswered count per task via `question.unansweredByTask()`. Animate with CSS `animate-bounce`. Place alongside existing badges in the right-aligned badge group. **Questions tab in task dialog:** Add a "Questions" tab to `task-dialog.tsx` (alongside Description, Plan, Execution) — shows all questions for that task with inline answering, same options/preview/multi-select UI as the standalone dialog. Submit all button. **Notification badge in header:** Add unanswered question count badge to `app-header.tsx` next to ThemeToggle, clicking opens the question list. **Question list** (`question-list.tsx`): Two sections: (a) task-scoped entries grouped by task (shows task title + unanswered count), (b) session-scoped entries (no task) where each session is its own entry. Clicking any entry opens its question dialog. **Question dialog** (`question-dialog.tsx`) scoped to a single task or session, with tabs: one tab per question labeled by `header` chip (question text, structured options list, optional preview panel rendered as HTML via markdown, multi-select support via checkboxes, free-text "Other" input, unanswered tabs show a dot indicator); Task tab (only when `taskId` is set) — task title and description; Document tab (when `documentPath` is set) — reuses the existing BlockNote document editor component in read-only mode. Single "Submit All" button in dialog footer — disabled until all questions have answers. Questions persist across page refresh (backed by SQLite).

7. **Run /engy:review, pnpm blt, test in Chrome** (depends on tasks 4, 5, 6)
   - Final validation task.
   - Implements verification.

**Parallelizable:** Task 1 has no dependencies. Tasks 2, 3 depend only on task 1 and can run concurrently. Task 4 depends on tasks 2 and 3. Tasks 5 and 6 can run concurrently — task 5 depends on task 4, task 6 depends on task 3. Task 7 depends on tasks 4, 5, 6.

### Completion Summary

{Leave blank until done.}

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
