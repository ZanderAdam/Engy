---
description: Task and task-group lifecycle, dependency graph, Eisenhower fields, bulk operations, and MCP surface.
order: 4
---

# Task Management

Tasks are the atomic unit of work in Engy. Each task belongs to an optional project, and may be further grouped by milestone reference (a free-text key matching a plan file on disk) and by a task group (a named container within a milestone). The full hierarchy is: Workspace → Project → Milestone → TaskGroup → Task.

## Key source files

- `web/src/server/trpc/routers/task.ts` — tRPC procedures: `create`, `list`, `get`, `update`, `listBySpecId`, `delete`, `bulkUpdate`, `bulkDelete`
- `web/src/server/trpc/routers/task-group.ts` — tRPC procedures: `create`, `list`, `get`, `update`, `delete`
- `web/src/server/tasks/validation.ts` — `validateDependencies()` (dedup, existence check, iterative-DFS cycle detection) and `attachBlockedBy()` (hydrates the `blockedBy` array from the `task_dependencies` join table)
- `web/src/server/tasks/task-group-numbering.ts` — `nextNumInMilestone()` (sequential counter per `(projectId, milestoneRef)` bucket)
- `web/src/server/mcp/index.ts` (lines 646–908) — MCP tools: `createTask`, `updateTask`, `listTasks`, `getTask`, `deleteTask`, `createTaskGroup`, `listTaskGroups`, `getTaskGroup`, `updateTaskGroup`, `deleteTaskGroup`
- `web/src/server/db/schema.ts` — `tasks`, `taskGroups`, `taskDependencies` tables
- `web/src/server/plan/service.ts` — `readTaskPlan()` used by `getTask` MCP tool to attach `.plan.md` content

## Tasks

A task row (`tasks` table) carries: `title`, `description`, `status` (`backlog`/`todo`/`in_progress`/`review`/`done`), `type` (`ai`/`human`), `importance` (`important`/`not_important`), `urgency` (`urgent`/`not_urgent`), `needsPlan`, `specId`, `subStatus` (`planning`/`implementing`/`blocked`/`failed`/`plan_review`), `sessionId`, `feedback`, and foreign keys to project and task group.

On creation, defaults are: `status='todo'`, `type='human'`, `needsPlan=true`, `importance='not_important'`, `urgency='not_urgent'`. The `blockedBy` relationship is stored in the separate `task_dependencies` join table (cascade-deleted when either task is deleted) and hydrated onto query results by `attachBlockedBy()`.

Both the tRPC and MCP surfaces share `validateDependencies` and `attachBlockedBy` from `web/src/server/tasks/validation.ts`. `task.create`, `task.update`, `task.bulkUpdate`, and `task.bulkDelete` all run inside a `db.transaction()`; single `task.delete` does not — it issues a bare `db.delete` followed by a broadcast. Every state-changing mutation fires `broadcastTaskChange` from `web/src/server/ws/broadcast.ts` so connected browsers receive real-time updates.

## Task groups

A task group (`task_groups` table) is a named container within a `(projectId, milestoneRef)` bucket. Its `numInMilestone` counter is assigned by `nextNumInMilestone()` which queries `MAX(numInMilestone)` for the bucket and returns `max + 1` (starts at 1 for empty buckets). Deletion leaves gaps — survivors are never renumbered. Task groups have a `status` enum (`planned`/`active`/`review`/`complete`) and an optional `repos` JSON array.

## MCP surface

The MCP `updateTask` tool accepts an optional `memories[]` array; each entry is inserted as a `fleetingMemory` row scoped to the task's workspace (resolved via `project.workspaceId`). If the task has no `projectId` the memories passthrough is silently skipped.

`listTasks` defaults to compact mode (`compact: true`), omitting `description`. Passing `compact: false` includes it. `getTask` always returns the full row plus `planContent` — the contents of the task's `.plan.md` file if it exists, read by `readTaskPlan()` from `web/src/server/plan/service.ts`, or `null` otherwise.

## AI task auto-start

When `task.create` is called with `type:'ai'` and `status:'todo'` and neither `taskGroupId` nor `milestoneRef` is set, `triggerAutoStart` is called fire-and-forget after the transaction commits. The same trigger fires on `task.update` when `type` changes from a non-`ai` value to `ai` under the same conditions. The execution mechanics live in the execution-engine area; task management only initiates the trigger.

## Eisenhower fields

`importance` and `urgency` are independent two-value enums stored verbatim on the task row. They are accepted on both create and update and persisted without any derived computation. The UI (`web/src/app/w/[workspace]/tasks/page.tsx`) renders these as an Eisenhower matrix, but the server imposes no matrix-placement logic.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-TASK-010 | WHEN `task.create` is called, the system SHALL insert a task row with `status='todo'`, `type='human'`, `needsPlan=true`, and `blockedBy=[]` as defaults, and broadcast a `created` task-change event. |
| FR-TASK-020 | WHEN `task.create` or `task.update` is called with a `blockedBy` array, the system SHALL deduplicate the entries and validate that every referenced task id exists, rejecting unknown ids with a `BAD_REQUEST` / MCP error identifying the missing id. |
| FR-TASK-030 | IF `task.update` is called with a `blockedBy` array that contains the task's own id, THEN the system SHALL reject the request with the error "A task cannot block itself". |
| FR-TASK-040 | IF updating a task's `blockedBy` array would create a cycle in the dependency graph, THEN the system SHALL reject the request with the error "Circular dependency detected" using an iterative depth-first search. |
| FR-TASK-050 | WHEN `task.update` is called with a `blockedBy` array, the system SHALL atomically replace all existing dependency rows for that task with the new set, clearing all blockers when the array is empty. |
| FR-TASK-060 | WHEN a blocker task is deleted, the system SHALL remove its corresponding `task_dependencies` rows via `onDelete: cascade`, so the formerly-blocked task resolves to an empty `blockedBy` array. |
| FR-TASK-070 | WHEN `task.create` or `task.update` is called with `importance` or `urgency` values, the system SHALL persist them verbatim (`important`/`not_important` and `urgent`/`not_urgent`) without computing any derived field. |
| FR-TASK-080 | WHEN `task.create` or `task.update` is called with `subStatus`, `sessionId`, or `feedback`, the system SHALL persist the supplied values; each field is independently nullable and can be cleared by passing `null`. |
| FR-TASK-090 | WHEN `task.bulkUpdate` is called with an `ids` array and a `milestoneRef` or `taskGroupId` value, the system SHALL update all matched tasks atomically in a single transaction, skip any ids that do not exist, and return `{updated: 0}` for an empty `ids` input. |
| FR-TASK-100 | WHEN `task.bulkDelete` is called with an `ids` array, the system SHALL delete all found tasks atomically, fire a `deleted` broadcast per task, skip ids that do not exist, and return `{deleted: 0}` for an empty `ids` input. |
| FR-TASK-110 | WHEN `task.list` or the MCP `listTasks` tool is called with any combination of `projectId`, `milestoneRef`, `taskGroupId`, and `status` filters, the system SHALL apply them with AND logic, hydrating each result's `blockedBy` array from `task_dependencies`. |
| FR-TASK-120 | WHEN the MCP `listTasks` tool is called with `compact` omitted or `true`, the system SHALL omit `description` from each result; passing `compact: false` SHALL include it. |
| FR-TASK-130 | WHEN the MCP `getTask` tool is called, the system SHALL return the full task row, its `blockedBy` array, and a `planContent` field containing the task's `.plan.md` file content if it exists, or `null` otherwise. |
| FR-TASK-140 | WHEN the MCP `updateTask` tool is called with a `memories` array and the task has a `projectId`, the system SHALL insert each entry as a `fleetingMemory` row scoped to the task's workspace; IF the task has no `projectId`, THEN the memories SHALL be silently skipped. |
| FR-TASK-150 | WHEN `taskGroup.create` or the MCP `createTaskGroup` tool is called, the system SHALL assign `numInMilestone` as `MAX(numInMilestone) + 1` within the `(projectId, milestoneRef)` bucket, starting at 1 for an empty bucket, with gaps left by deletions never refilled. |
| FR-TASK-160 | WHEN `taskGroup.get` / `getTaskGroup` or `taskGroup.update` / `updateTaskGroup` is called with an id that does not exist, the system SHALL return `NOT_FOUND` / MCP error. |
| FR-TASK-170 | WHEN `task.create` is called with `type:'ai'` and `status:'todo'` and neither `taskGroupId` nor `milestoneRef` is set, the system SHALL invoke `triggerAutoStart` fire-and-forget after the transaction commits; the same trigger SHALL fire on `task.update` when `type` transitions to `'ai'` under the same conditions. |

## Sources

No prior knowledge found.
