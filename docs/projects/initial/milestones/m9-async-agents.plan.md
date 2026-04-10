---
title: Async Agents
status: active
---

# Plan: M9 Async Agents

## Overview

M9 delivers autonomous agent execution for standalone tasks. The workspace `autoStart` flag triggers background execution when a task becomes AI-assigned. A planning-first workflow lets `needsPlan=true` tasks get planned before implementation — planning runs in the execution environment (container/Coder) with `--dangerously-skip-permissions`, then the plan file syncs locally for human review with inline comments. On approval, a new implementation session starts. A workspace-level `autoAgentCompletion` setting controls what happens when the agent finishes: push + create a PR, or have the daemon merge the worktree branch into main with `--no-ff`.

Boundary: no auto-start for tasks in task groups or milestones (standalone only), no Mastra (Claude CLI directly), no plan diffing/version history, no automatic plan approval, no remote execution (claude.ai), no worktree cleanup after merge, no file sync for non-Coder/non-devcontainer environments.

## Codebase Context

**What M1–M8 shipped:**

- SQLite schema with workspaces (containerEnabled, containerConfig, maxConcurrency, autoStart, containerMode/coderWorkspace), projects, taskGroups, tasks, agentSessions, comments/threads
- Execution engine (M6): runner loop on client daemon, `dispatchExecutionStart()` in `server.ts`, `startExecution` tRPC mutation with session guard, `handleExecutionCompleteEvent()` for task status transitions, per-session git worktrees
- Dev containers (M6): `@devcontainers/cli` integration, `ContainerManager`, config generator with bind mounts, `--dangerously-skip-permissions` in container mode only
- Coder support: `containerMode='coder'` with `coder ssh` for remote execution, session file reading via `coder ssh -- cat`
- WebSocket protocol: discriminated union in `common/`, pending maps pattern for request/response, existing `FILE_READ_REQUEST`/`FILE_WRITE_REQUEST` (local filesystem only)
- Diff viewer (M5): inline comments via `DynamicDocumentEditor` + `EngyThreadStore`, `formatCommentsForExport()`, `SendToTerminalButton`
- Terminal integration (M4): xterm.js, `terminal:inject` with optional `terminalId`, `useTaskTerminals()` hook
- UI: task views (kanban, eisenhower, dependency graph), `ExecutionStatusIcon` (handles planning/implementing/blocked/failed), `Sheet` component, container settings panel

**Key existing patterns:**

- `buildPromptForTask()` in `execution.ts` — constructs implementation prompt using `workspace.implementSkill || '/engy:implement'`
- `buildContextBlock()` in `shell.ts` — builds workspace/project context for agent system prompts
- `dispatchExecutionStart(ctx.state, sessionId, prompt, flags, config)` in `server.ts` — dispatches to daemon
- Plan files live at `{projectDir}/plans/{taskSlug}.plan.md`, read on-the-fly by `readTaskPlan()` (no DB column)

## Task Group Sequencing

- **TG1: Auto-Start & Planning Execution** — no dependencies. Can start immediately. Schema enums, migration, auto-start engine, completion handlers, system prompt, and settings UI. All `web/` package work.
- **TG2: File Sync & Merge** — no dependencies. Can start immediately, parallelizable with TG1. Protocol messages, daemon handlers for Coder file sync and worktree merge. Primarily `client/` and `common/` packages.
- **TG3: Plan Review UI** — depends on TG1 (needs `plan_review` subStatus transitions working) and TG2 (needs `REMOTE_FILE_PUSH` for Coder approve flow). All frontend components.

```
TG1 ──┬── TG3
TG2 ──┘
```

## TG1: Auto-Start & Planning Execution

Schema foundation plus the core server-side engine in one vertical slice. Adds `plan_review` subStatus, `planning` executionMode, `autoAgentCompletion` workspace column, then wires up `triggerAutoStart` that fires when tasks become AI-assigned, routes to planning or implementation based on `needsPlan`, handles planning completion (subStatus transition to `plan_review`, Coder file pull dispatch), and handles implementation completion (merge dispatch for merge mode). Includes system prompt completion strategy and settings UI so all new schema fields have consumers.

### Requirements

1. The system shall support `'plan_review'` as a valid task `subStatus` value. *(inferred: needed for planning completion flow)* (FR-TG1.1)
2. The system shall support `'planning'` as a valid `executionMode` value on agent sessions. *(inferred: distinguishes planning from implementation in completion handler)* (FR-TG1.2)
3. The system shall store `autoAgentCompletion` (`'pr'` | `'merge'`, default `'pr'`) on workspaces with DB migration. *(elicited)* (FR-TG1.3)
4. When a task is created with `type='ai'`, no `taskGroupId`, no `milestoneRef`, and `workspace.autoStart=true` → auto-start execution. *(elicited)* (FR-TG1.4)
5. When a task is updated with `type` changed to `'ai'`, `status='todo'`, no `taskGroupId`, no `milestoneRef`, and `workspace.autoStart=true` → auto-start execution. *(user request)* (FR-TG1.5)
6. If `needsPlan=true` → start planning execution using `workspace.planSkill || '/engy:plan'`. Set `executionMode='planning'`, `subStatus='planning'`. *(user request)* (FR-TG1.6)
7. If `needsPlan=false` → start implementation execution using `workspace.implementSkill || '/engy:implement'`. Set `subStatus='implementing'`. *(user request)* (FR-TG1.7)
8. Auto-start respects `workspace.maxConcurrency` — silently skip if at limit. *(inferred)* (FR-TG1.8)
9. Auto-start is fire-and-forget: failures log and set `subStatus='failed'`, never block task CRUD. *(inferred)* (FR-TG1.9)
10. `triggerAutoStart` shall call `startExecution` via tRPC caller, not duplicate dispatch logic. *(validation fix)* (FR-TG1.10)
11. When a planning session completes successfully → task `subStatus='plan_review'`, `status` stays `'in_progress'`. For Coder workspaces, dispatch `REMOTE_FILE_PULL` to sync plan file locally. *(inferred)* (FR-TG1.11)
12. When an implementation session completes successfully with `autoAgentCompletion='merge'` → dispatch `WORKTREE_MERGE_REQUEST` to daemon. *(elicited)* (FR-TG1.12)
13. The system shall include agent completion strategy instructions in the system prompt context block. PR mode: instruct agent to push and create PR. Merge mode: no agent instruction (daemon handles). *(elicited)* (FR-TG1.13)
14. The system shall expose `autoAgentCompletion` in workspace create/update Zod schemas and container settings UI. *(inferred)* (FR-TG1.14)

### Tasks

1. **Schema enums, migration & Zod updates**
   - Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/` [NEW], `web/src/server/trpc/routers/workspace.ts` [MODIFY], `web/src/server/trpc/routers/task.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.2, FR-TG1.3, FR-TG1.14
   - Add `'plan_review'` to subStatus enum, `'planning'` to executionMode enum (TypeScript-only, no migration). Add `autoAgentCompletion` column to workspaces table with migration. Update workspace router Zod schemas. Add `'plan_review'` to task router subStatus Zod enum.

2. **Build prompt for planning & triggerAutoStart** (depends on task 1)
   - Files: `web/src/server/trpc/routers/execution.ts` [MODIFY]
   - Implements FR-TG1.6, FR-TG1.7, FR-TG1.8, FR-TG1.9, FR-TG1.10
   - Add `buildPromptForPlan()` mirroring `buildPromptForTask()`. Add `triggerAutoStart(caller, taskId)` that checks conditions (autoStart, standalone, concurrency) and calls `startExecution` via tRPC caller. Add `'planning'` to executionMode Zod schemas.

3. **Wire auto-start into task mutations** (depends on task 2)
   - Files: `web/src/server/trpc/routers/task.ts` [MODIFY]
   - Implements FR-TG1.4, FR-TG1.5
   - Make `create`/`update` handlers async. After successful write, check auto-start conditions and call `triggerAutoStart`. For `update`, read previous task to detect type change.

4. **Planning & implementation completion handlers** (depends on task 1)
   - Files: `web/src/server/ws/server.ts` [MODIFY], `web/src/server/trpc/context.ts` [MODIFY]
   - Implements FR-TG1.11, FR-TG1.12
   - In `handleExecutionCompleteEvent`: branch on `executionMode='planning'` + success → set `subStatus='plan_review'`, keep `status='in_progress'`, dispatch `REMOTE_FILE_PULL` for Coder. Branch on implementation success + `autoAgentCompletion='merge'` → dispatch `WORKTREE_MERGE_REQUEST`. Add pending maps for new message types.

5. **System prompt completion strategy, settings UI & auto-start indicator** (depends on task 1)
   - Files: `web/src/lib/shell.ts` [MODIFY], `web/src/components/workspace/container-settings.tsx` [MODIFY], `web/src/app/w/[workspace]/projects/[project]/layout.tsx` [MODIFY]
   - Implements FR-TG1.13, FR-TG1.14 (UI), FR-TG1.4 (visual)
   - Extend `buildContextBlock` to accept `autoAgentCompletion` and include completion instructions. Add "When auto-agent completes" select in container settings UI. Add red dot indicator in project header when `workspace.autoStart` is enabled with tooltip.

**Parallelizable:** Task 1 first. Then tasks 2, 4, 5 can run concurrently (different files). Task 3 depends on task 2.

### Completion Summary

*Updated after TG completes.*

## TG2: File Sync & Merge

WebSocket protocol messages and all client daemon handlers. File sync via `coder ssh` for reading/writing files on remote Coder workspaces, and worktree branch merging with `--no-ff` for the merge completion strategy. Protocol messages are defined here alongside their consumers so no types are orphaned.

### Requirements

1. The system shall define `REMOTE_FILE_PULL` and `REMOTE_FILE_PUSH` WebSocket message types for reading/writing files on remote execution environments. *(elicited)* (FR-TG2.1)
2. The system shall define `WORKTREE_MERGE_REQUEST` and `WORKTREE_MERGE_RESULT` WebSocket message types for daemon-side branch merging. *(elicited)* (FR-TG2.2)
3. The daemon shall handle `REMOTE_FILE_PULL` by reading the specified file from the Coder workspace via `coder ssh -- cat` and returning its content. *(elicited)* (FR-TG2.3)
4. The daemon shall handle `REMOTE_FILE_PUSH` by writing content to the specified file on the Coder workspace via `coder ssh -- bash -c 'cat > file'`. *(elicited)* (FR-TG2.4)
5. The daemon shall handle `WORKTREE_MERGE_REQUEST` by resolving the branch from the worktree path, running `git merge --no-ff <branch>` in the main repo, and returning the result. *(elicited)* (FR-TG2.5)
6. File sync shall handle missing files gracefully (e.g., planning agent didn't write a plan file). *(inferred)* (FR-TG2.6)
7. Merge shall handle conflicts gracefully — surface error to user via merge result message. *(inferred)* (FR-TG2.7)

### Tasks

1. **Protocol messages & daemon file sync handlers**
   - Files: `common/src/ws/protocol.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY]
   - Implements FR-TG2.1, FR-TG2.3, FR-TG2.4, FR-TG2.6
   - Add `RemoteFilePullRequestMessage`/`RemoteFilePullResultMessage`, `RemoteFilePushRequestMessage`/`RemoteFilePushResultMessage` to protocol. Handle `REMOTE_FILE_PULL` in daemon: `coder ssh {workspace} -- cat {path}`. Handle `REMOTE_FILE_PUSH`: `coder ssh {workspace} -- bash -c 'cat > {path}'`. Return error for missing files.

2. **Protocol messages & daemon worktree merge handler** (depends on task 1 — same files)
   - Files: `common/src/ws/protocol.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY]
   - Implements FR-TG2.2, FR-TG2.5, FR-TG2.7
   - Add `WorktreeMergeRequestMessage`/`WorktreeMergeResultMessage` to protocol. Handle in daemon: resolve branch from worktree path via `git worktree list`, run `git merge --no-ff <branch>` in main repo, return success/failure with error on conflict.

**Serialized:** Both tasks modify `protocol.ts` and `client.ts` — must run sequentially (task 1 → task 2).

### Completion Summary

*Updated after TG completes.*

## TG3: Plan Review UI

The frontend experience for reviewing plans produced by planning agents. A slide-over sheet with the plan editor, inline comments, and session-aware action buttons (approve, send feedback, send to terminal). Includes the `plan_review` status indicator on task cards.

### Requirements

1. Plan review shall open in a large slide-over sheet dialog with the full plan, inline comments sidebar, and action bar. *(elicited)* (FR-TG3.1)
2. The plan editor shall support inline comments via `DynamicDocumentEditor` with `comments={true}` and `EngyThreadStore`. *(elicited)* (FR-TG3.2)
3. "Approve & Implement" shall be disabled while the planning session is active/paused. When enabled, it calls `startExecution` to start a new implementation session. *(validation fix)* (FR-TG3.3)
4. "Send to Task Session" shall push the edited plan file back via `REMOTE_FILE_PUSH` for Coder workspaces, then route formatted comments to the planning session (resume via `sendFeedback`). *(user request)* (FR-TG3.4)
5. "Send to Active Terminal" shall use existing `useSendToTerminal` behavior, always available when any terminal is active. *(existing behavior)* (FR-TG3.5)
6. On any feedback send or approval for Coder workspaces, push edited plan file back before the action. *(user request)* (FR-TG3.6)
7. When task `subStatus === 'plan_review'`, show a visual indicator on the task card. Clicking it opens the plan review sheet. *(user request)* (FR-TG3.7)

### Tasks

1. **ExecutionStatusIcon plan_review entry & useSendToTerminal terminalId**
   - Files: `web/src/components/projects/execution-status-icon.tsx` [MODIFY], `web/src/components/terminal/use-send-to-terminal.ts` [MODIFY]
   - Implements FR-TG3.7 (partial), FR-TG3.5 (partial)
   - Add `'plan_review'` to iconMap (clipboard icon), tooltipMap ("Plan ready for review"), styleMap (amber). Extend `sendToTerminal` with optional `terminalId` param.

2. **PlanActions component** (depends on task 1)
   - Files: `web/src/components/projects/plan-actions.tsx` [NEW]
   - Implements FR-TG3.3, FR-TG3.4, FR-TG3.5, FR-TG3.6
   - Action bar with three buttons: "Approve & Implement" (disabled while session active/paused, calls `startExecution`), "Send to Task Session" (pushes plan for Coder, resumes session with comments), "Send to Active Terminal". Uses `useTaskTerminals`, `useExecutionStatus`, `trpc.execution.sendFeedback`, `useSendToTerminal`, `formatCommentsForExport`.

3. **PlanReviewSheet component** (depends on task 2)
   - Files: `web/src/components/projects/plan-review-sheet.tsx` [NEW]
   - Implements FR-TG3.1, FR-TG3.2
   - Large slide-over using `Sheet`/`SheetContent`. Contains `DynamicDocumentEditor` with `comments={true}` + `EngyThreadStore` for the plan document path. `PlanActions` at the bottom. Props: `open`, `onOpenChange`, `taskId`, `workspaceSlug`, `projectSlug`, `projectDir`, `taskSlug`.

4. **Task card & dialog integration** (depends on tasks 1, 3)
   - Files: `web/src/components/projects/task-card.tsx` [MODIFY], `web/src/components/projects/task-dialog.tsx` [MODIFY]
   - Implements FR-TG3.7
   - Add click handler on `ExecutionStatusIcon` when `subStatus === 'plan_review'` to open `PlanReviewSheet`. Update task dialog Plan tab with "Open Full Review" button.

**Sequential:** 1 → 2 → 3 → 4.

### Completion Summary

*Updated after TG completes.*

## Non-Functional Requirements

- Auto-start dispatch must not block task CRUD operations — async fire-and-forget with try/catch logging.
- `subStatus` and `executionMode` enum changes are TypeScript-only (SQLite text columns), no migration needed.
- DB migration needed only for `auto_agent_completion` column on workspaces table.
- Merge mode must handle conflicts gracefully — surface error via result message, set task `subStatus='failed'` with conflict details.
- File sync (`REMOTE_FILE_PULL`/`PUSH`) must handle missing files gracefully.

## Out of Scope

- Auto-start for tasks in task groups or milestones (standalone only)
- Auto-start for remote execution (claude.ai)
- Mastra integration (using Claude CLI directly; Mastra deferred)
- Plan diffing or version history
- Automatic plan approval (always requires explicit user action)
- Worktree cleanup after merge (future enhancement)
- File sync for non-Coder, non-devcontainer environments
- Plan review notifications (toast/badge) — task card indicator provides passive visibility
- Changes to the workspace autoStart toggle UI (already exists)
