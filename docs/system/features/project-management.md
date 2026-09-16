---
description: Project lifecycle, spec.md state machine, file tree and context file CRUD, plan slug enumeration, and the two-step completion/archive flow.
order: 3
---

# Project Management

Projects are the primary unit of bounded work inside a workspace. Each project
has a DB row in the `projects` table (`web/src/server/db/schema.ts`), a
directory under `{ENGY_DIR}/{workspace-slug}/projects/{project-slug}/`, and a
`spec.md` file that carries a typed state machine. Project management spans
project CRUD, status lifecycle, spec.md lifecycle gating, a general file tree,
a separate `context/` subdirectory, plan-slug enumeration, worktree branch
re-rooting, and a two-step completion/archive flow.

## Key components

| File | Role |
|---|---|
| `web/src/server/trpc/routers/project.ts` | tRPC procedures: `create`, `list`, `get`, `getBySlug`, `listWithProgress`, `updateStatus`, `delete`, `listFiles`, `getSpec`, `updateSpec`, `readFile`, `readImage`, `writeFile`, `mkdir`, `deleteFile`, `deleteDir`, `renameFile`, `renameDir`, `listContextFiles`, `readContextFile`, `writeContextFile`, `deleteContextFile`, `startCompletion`, `archive`, `getTaskPlans` |
| `web/src/server/project/service.ts` | Pure filesystem helpers: `initProjectDir`, `removeProjectDir`, `listProjectFiles`, `getProjectSpec`, `updateProjectSpec`, `readProjectFile`, `readProjectImage`, `writeProjectFile`, `mkdirProject`, `deleteProjectFile`, `deleteProjectSubDir`, `renameProjectFile`, `renameProjectSubDir`, `listProjectContextFiles`, `readProjectContextFile`, `writeProjectContextFile`, `deleteProjectContextFile`, `checkProjectReadiness` (module-private: `validatePath`) |
| `web/src/server/services/project-completion.ts` | `ProjectCompletionService` — `startCompletion` and `archive`; singleton exported as `projectCompletionService` |
| `web/src/server/mcp/index.ts` | `startProjectCompletion` and `archiveProject` MCP tools (registered inside `registerWorkspaceTools`) |
| `web/src/server/db/schema.ts` | `projects` table — `id`, `workspaceId`, `name`, `slug`, `status` (enum), `isDefault`, `projectDir`, `createdAt`, `updatedAt` |
| `web/src/server/engy-dir/effective.ts` | `resolveEffectiveWorkspace` — maps an optional `worktreeBranch` to a re-rooted `docsDir` |

## Project create and delete

`project.create` derives a slug via `uniqueProjectSlug` (from
`web/src/server/trpc/utils.ts`), inserts the DB row with `status='planning'`,
then calls `initProjectDir` to create
`{workspaceDir}/projects/{slug}/` and seed a `spec.md` with
`type=buildable, status=draft`. If `initProjectDir` throws, a compensating
`db.delete` removes the DB row before re-throwing, preventing partial state.
`initProjectDir` checks for an existing `spec.md` before writing, so a
hand-authored file is preserved.

`project.delete` removes the DB row first, then attempts best-effort removal of
the directory via `removeProjectDir`; filesystem failure is silently swallowed
since the DB row is already gone.

## Status lifecycle

The `projects.status` column accepts four values:
`planning | active | completing | archived`. The tRPC `updateStatus` procedure
accepts any of these values without enforcing a directed graph — transitions are
free-form at the DB layer. The two-step completion gate (see below) enforces an
ordering between `completing` and `archived` separately.

## Spec.md state machine

`updateProjectSpec` / `updateSpec` in `project/service.ts` enforce a typed
one-way state machine keyed on `spec.type`:

- **Buildable path:** `draft → ready → approved → active → completed`. Any
  out-of-order step throws `"Invalid status transition"`. The `draft → ready`
  step additionally calls `checkProjectReadiness`, which requires all of the
  project's tasks to have `status='done'` (per project, not per workspace).
- **Vision path:** `draft → completed` only. `draft → ready` is rejected.

Both paths are defined as `BUILDABLE_TRANSITIONS` and `VISION_TRANSITIONS` maps
in `project/service.ts`. `updateProjectSpec` calls the shared `validatePath`
guard to prevent directory traversal before any disk access.

## File tree and spec.md protection

`listProjectFiles` traverses the project directory up to `MAX_PROJECT_DEPTH = 5`
levels, skipping hidden entries, and returns a `{ files, dirs, type, status }`
shape. `readProjectFile` enforces a 2 MB cap (`MAX_TEXT_BYTES`); the router
adds a binary-extension check via `isTextPath` before delegating.

`writeProjectFile` and `deleteProjectFile` in `project/service.ts` reject paths
that resolve to `spec.md`; the tRPC `writeFile` and `deleteFile` inputs add an
additional Zod `.refine` that catches the bare `spec.md` string at schema
validation time. `renameProjectFile` likewise rejects `spec.md` as the source.
`deleteProjectSubDir` rejects paths whose resolved absolute path equals the
project root (enforced by a path-resolution equality check in the service, not
by Zod). All path operations pass through `validatePath` to catch traversal
aliases.

## Context files

A separate `{project}/context/` subdirectory holds context files for agent
injection. `writeProjectContextFile` creates the directory if absent and writes
the file; `readProjectContextFile` and `deleteProjectContextFile` throw `not
found` when the file is absent. All four operations pass filenames through
`validatePath` to reject traversal.

## Task plan enumeration

`getTaskPlans` returns every plan in a project keyed by task id, computed by
`readTaskPlans` (`web/src/server/plan/service.ts`). Non-`.plan.md` files, plans
naming another workspace's tasks, and a missing `plans/` directory all yield no
entry. This is the only place plan selection happens: `findTaskPlanPath` — the
server-side single-task lookup — is a lookup into the same map, so server and
browser can never disagree about which file is a task's plan.

## Task plan file naming

A task's plan file is `{project}/plans/<workspace-slug>-T<task-id>[-<description>].plan.md`.
The `<workspace-slug>-T<task-id>` part is the task identifier used in agent
prompts and the UI; the trailing `-<description>` is written by the planning
agent so the filename says what the plan is about. Because the description is
not derivable from task metadata, consumers resolve the filename instead of
computing it. `web/src/lib/plan-naming.ts` owns the naming rules — the `plans/`
directory and `.plan.md` extension constants, `taskPlanSlug`, and the
stem parsers `taskIdFromStem` / `taskSlugFromStem` — and `readTaskPlans` in
`web/src/server/plan/service.ts` is the sole resolver. A replan reuses the
filename that already exists so plan comment threads, which are keyed by file
path, stay attached.

## Worktree branch re-rooting

`getBySlug`, `getSpec`, all file read/write procedures, and context file
operations accept an optional `worktreeBranch`. When present,
`resolveEffectiveWorkspace` (from `engy-dir/effective.ts`) maps the branch to an
alternative `docsDir` for git-worktree-aware path resolution. When `docsDir` is
outside a git repo, the branch is a no-op and the effective path is unchanged.

## Two-step completion and archive

The completion flow is a two-step gate enforced by `ProjectCompletionService`
(`services/project-completion.ts`):

1. **`startCompletion`** — sets `status='completing'` and returns all
   unpromoted `fleetingMemories` scoped to the same workspace, sorted by signal
   score (tags present > non-agent-sourced > has `sources` references), with newest
   as tiebreaker. Already-promoted memories are excluded. Memories from other
   workspaces are not returned.

2. **`archive`** — requires `status='completing'`; throws `PRECONDITION_FAILED`
   otherwise. Sets `status='archived'`, then hard-deletes all `agentSessions`
   linked to the project's tasks or task groups. Tasks, task groups, fleeting
   memories, and plan files are preserved. Sessions belonging to other projects
   are untouched.

Both operations are exposed as tRPC procedures (`project.startCompletion`,
`project.archive`) and as MCP tools (`startProjectCompletion`, `archiveProject`)
registered in `registerWorkspaceTools`. Both MCP handlers delegate to the same
`projectCompletionService` singleton; errors are returned via `mcpError(message)`
rather than thrown.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-PROJECT-010 | WHEN `project.create` is called with a valid workspace slug and name, the system SHALL insert a DB row with `status='planning'` and a slug derived from the name, and SHALL materialise `{workspaceDir}/projects/{slug}/` with a seeded `spec.md` (`type=buildable, status=draft`). |
| FR-PROJECT-020 | IF `initProjectDir` throws during `project.create`, the system SHALL delete the newly inserted DB row before re-throwing, leaving no partial state on disk or in the database. |
| FR-PROJECT-030 | WHEN `initProjectDir` runs and a `spec.md` already exists in the target directory, the system SHALL preserve the existing file without overwriting it. |
| FR-PROJECT-040 | WHEN `project.listWithProgress` is called, the system SHALL return all projects for the workspace, each decorated with `taskCount` and `completedTasks` derived from live task rows. |
| FR-PROJECT-050 | WHEN `project.updateStatus` is called with a valid project id and a status value from the enum (`planning`, `active`, `completing`, `archived`), the system SHALL update the row and return the updated project. |
| FR-PROJECT-060 | WHEN `project.delete` is called, the system SHALL remove the DB row first and then attempt best-effort removal of the project directory; IF directory removal fails, the system SHALL swallow the error and return `{ success: true }`. |
| FR-PROJECT-070 | WHEN `updateProjectSpec` is called with a status transition on a buildable spec, the system SHALL enforce the one-way sequence `draft → ready → approved → active → completed` and SHALL throw `"Invalid status transition"` for any out-of-sequence step. |
| FR-PROJECT-080 | WHEN `updateProjectSpec` is called with a `draft → ready` transition on a buildable spec, the system SHALL reject the transition with `"Cannot mark spec as ready: incomplete tasks exist"` if any task linked to the project does not have `status='done'`. |
| FR-PROJECT-090 | WHEN `updateProjectSpec` is called with any status transition on a vision spec, the system SHALL enforce `draft → completed` as the only permitted step and SHALL throw `"Invalid status transition"` for any other transition including `draft → ready`. |
| FR-PROJECT-100 | The system SHALL reject `writeFile`, `deleteFile`, and `renameFile` requests targeting `spec.md` (including paths that resolve to `spec.md` after traversal normalisation), and SHALL reject `deleteDir` requests whose resolved path equals the project root directory (enforced by service-level path-resolution equality, not Zod input validation). |
| FR-PROJECT-110 | IF `readFile` is called with a path whose extension is not in the text-file allowlist, the system SHALL reject the request with `BAD_REQUEST`. |
| FR-PROJECT-120 | WHEN `writeContextFile` is called, the system SHALL create `{project}/context/` if absent and write the file; WHEN `readContextFile` or `deleteContextFile` is called for a filename that does not exist, the system SHALL throw `NOT_FOUND`. |
| FR-PROJECT-130 | WHEN `getTaskPlans` is called, the system SHALL return the project-relative path of every `*.plan.md` file under `{project}/plans/` keyed by the task id its filename names, and SHALL return an empty map when the `plans/` directory is absent. |
| FR-PROJECT-140 | WHEN `project.startCompletion` is called, the system SHALL set the project's status to `completing` and SHALL return all unpromoted fleeting memories scoped to the same workspace, sorted by signal score descending (tags-present, then non-agent-sourced, then has-sources), with newest-first as tiebreaker; promoted memories and memories from other workspaces SHALL be excluded. |
| FR-PROJECT-150 | WHEN `project.archive` is called and the project's status is not `completing`, the system SHALL reject the request with `PRECONDITION_FAILED`. |
| FR-PROJECT-160 | WHEN `project.archive` is called on a project in `completing` status, the system SHALL set `status='archived'` and SHALL hard-delete all matching `agentSessions` rows linked to the project's tasks or task groups, leaving tasks, task groups, fleeting memories, and plan files intact; agent sessions belonging to other projects SHALL be unaffected. |
| FR-PROJECT-180 | WHEN resolving a task's plan file, the system SHALL match `{project}/plans/<workspace-slug>-T<task-id>[-<description>].plan.md`, SHALL NOT match a stem whose task id only shares the prefix (`ws-T50` for task 5) or whose workspace slug differs, and SHALL select the most recently written file when several match. |
| FR-PROJECT-170 | The system SHALL expose `startProjectCompletion` and `archiveProject` as MCP tools that delegate to the `projectCompletionService` singleton and return errors via `mcpError(message)` rather than throwing. |

## Sources

No prior knowledge found.
