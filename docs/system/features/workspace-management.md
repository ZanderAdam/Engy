---
description: Workspace lifecycle — create, read, update, delete, directory scaffold, git init, and daemon sync.
order: 2
---

# Workspace Management

Workspaces are the top-level organisational unit in Engy. Each workspace owns a
set of repos, a knowledge-base directory on disk, and configuration that drives
the planning and implementation skills. Workspace management spans the full
CRUD surface exposed via tRPC (`workspaceRouter` in
`web/src/server/trpc/routers/workspace.ts`) and a subset of MCP tools
(`registerWorkspaceTools` in `web/src/server/mcp/index.ts`), backed by a
single SQLite `workspaces` table (`web/src/server/db/schema.ts`).

## Key components

| File | Role |
|---|---|
| `web/src/server/trpc/routers/workspace.ts` | tRPC create / update / list / get / delete mutations and queries |
| `web/src/server/engy-dir/init.ts` | `initWorkspaceDir`, `renameWorkspaceDir`, `removeWorkspaceDir`, `writeWorkspaceYaml`, `getWorkspaceDir` |
| `web/src/server/engy-dir/git.ts` | `ensureGitRepo`, `isInsideGitRepo` |
| `web/src/server/engy-dir/backfill-m7.ts` | `backfillM7`, `needsM7Backfill` — knowledge-layer migration for pre-M7 workspaces |
| `web/src/server/mcp/index.ts` (`registerWorkspaceTools`) | `listWorkspaces`, `getWorkspaceDetails`, `listProjects`, `getProjectDetails`, `setWorkspaceEarsBdd` MCP tools |
| `web/src/server/db/schema.ts` | `workspaces` table definition |

## Slug generation

A workspace slug is derived from the name at creation time via `generateSlug`
(`web/src/server/trpc/utils.ts`): lowercase, non-alphanumeric characters
replaced with hyphens, consecutive hyphens collapsed. Collisions are resolved
by appending a numeric suffix (`-2`, `-3`, …) via `uniqueWorkspaceSlug`. The
slug is immutable through name changes but can be explicitly updated via
`workspace.update({ slug })`, which renames the on-disk directory atomically.

## Directory scaffold

`initWorkspaceDir` creates the workspace root (either at `docsDir` or
`{ENGY_DIR}/{slug}`), writes `workspace.yaml`, seeds `system/overview.md`, and
creates `system/features/`, `system/technical/`, `projects/`, `docs/`, and the
full `memory/` hierarchy (five Zettelkasten subtype dirs plus `sources/` and
`references/`). A `README.md` with an `<!-- INDEX START -->` /
`<!-- INDEX END -->` marker block is seeded into `system/`, `system/features/`,
`system/technical/`, and every `memory/` directory (via `seedReadme`); `projects/`
and `docs/` are created without a README. The workspace name must not contain
`/` or `\`; slugs with path traversal characters (`/`, `\`, `..`, `.`) are
rejected before any disk write.

## Path validation and daemon dependency

Any `repos` paths or a changed `docsDir` must be validated by the client daemon
via `dispatchValidation` before the DB row is written. When the daemon is not
connected, operations that pass non-empty repos or a new `docsDir` fail with
`PRECONDITION_FAILED`. The `createMissingDirs` flag switches missing-path
errors into `CREATE_DIR_REQUEST` dispatches; duplicate paths in `repos` are
deduplicated before the request is sent.

## Compensating actions (create)

Workspace creation is not transactional across the DB and the filesystem.
Compensating deletes guard each step: if `initWorkspaceDir` throws, the DB row
is deleted before re-throwing. If default project insert or `initProjectDir`
fails after the workspace directory exists, both the directory and the DB row
are removed. The result is that partial state is never left on disk or in the DB.

## Git initialisation

After the directory scaffold, `ensureGitRepo` (from `engy-dir/git.ts`) is
called on the workspace directory. It initialises a git repo, sets `user.name`,
`user.email`, and `commit.gpgsign=false`, then commits the initial structure
with `memory(init): initial workspace structure`. If the directory already
contains a `.git`, the call is a no-op (`return false`). Failure is non-fatal:
a warning is logged and `workspace.create` succeeds regardless. A nested git
boundary is intentional — a workspace may sit inside another git tree and still
initialises its own repo.

## workspace.yaml

Every mutation that changes workspace fields rewrites `workspace.yaml` via
`writeWorkspaceYaml`. The file contains `name`, `slug`, `repos` (as a list of
`{ path }` objects), and, when set, `docsDir`, `planSkill`, `implementSkill`,
and `earsBdd: true`. Fields absent from the object are omitted from the YAML.
The file is the on-disk source of truth read by the client daemon and AI agents.

## Slug rename and rollback

When `workspace.update` changes the slug, `renameWorkspaceDir` renames the
on-disk directory (only when `docsDir` is null — a custom `docsDir` path does
not follow the `{ENGY_DIR}/{slug}` convention). If the rename fails, the router
performs a full DB rollback of all fields written in that update, then
re-syncs `workspace.yaml` and broadcasts `WORKSPACES_SYNC` with the restored
state before throwing.

## Daemon sync (WORKSPACES_SYNC)

After every create, update, or delete, `broadcastWorkspacesSync` sends a
`WORKSPACES_SYNC` WebSocket message to the daemon (if connected at
`readyState === 1`). The payload is the full current workspace list
(`slug`, `repos`, `docsDir`). This keeps the daemon's in-memory workspace
registry consistent without requiring a restart.

## Delete

`workspace.delete` removes the DB row first, then attempts to remove the
workspace directory via `removeWorkspaceDir`. Directory removal failure is
non-fatal (logged as a warning); the call still returns `{ success: true }`.
Deleting a workspace cascades to all associated projects via SQLite foreign-key
`onDelete: 'cascade'`.

## combinedWorktrees

`workspace.get` returns a computed `combinedWorktrees` boolean via
`deriveCombinedWorktrees`. It is `false` when `splitWorktrees` is explicitly
set, or when `docsDir` is nested inside one of the `repos` paths (detected by
`isDocsDirInsideRepo`). Combined-worktrees mode is only safe when the docs
directory is not repo-dependent; the flag tells the UI whether to render a
merged or split project view.

## MCP surface

`registerWorkspaceTools` exposes the read/discovery surface to AI agents:
`listWorkspaces` (id / name / slug only), `getWorkspaceDetails` (full row plus
a `paths` object with resolved filesystem roots and nested projects with
`projectDir`), `listProjects`, and `getProjectDetails` (project row plus
workspace context, per-task-group execution summary, and active agent
sessions). `getWorkspaceDetails` and `getProjectDetails` return an `mcpError`
for an unknown id; `listWorkspaces` takes no id, and `listProjects` returns an
empty array (not an error) for a workspace with no projects. The same
registration also wires `setWorkspaceEarsBdd` (toggles `earsBdd` in the DB and
rewrites `workspace.yaml`). Two further tools registered here —
`startProjectCompletion` and `archiveProject` — are project-lifecycle
operations documented under the project-management area.

## Knowledge-layer backfill (M7 migration)

`backfillM7` (`engy-dir/backfill-m7.ts`) is a forward-only migration that adds
the full `memory/` hierarchy and READMEs to workspaces created before M7.
`needsM7Backfill` returns `true` when `memory/README.md` is absent. The
backfill is idempotent (skips existing directories and READMEs), appends `.qmd/`
to `.gitignore` (trailing-newline safe), runs the indexer, then commits only the
newly added files with `memory(init): backfill knowledge-layer directories`. A
second run creates no additional commit.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-WORKSPACE-010 | WHEN `workspace.create` is called, the system SHALL derive a URL-safe slug from the name (lowercase, non-alphanumeric → hyphens) and append a numeric suffix (`-2`, `-3`, …) if the derived slug is already in use. |
| FR-WORKSPACE-020 | WHEN `workspace.create` or `workspace.update` receives non-empty `repos` or a changed `docsDir` while no daemon is connected, the system SHALL reject the request with `PRECONDITION_FAILED`. |
| FR-WORKSPACE-022 | IF a provided `repos` or `docsDir` path does not exist and `createMissingDirs` is false, the system SHALL reject the request with `BAD_REQUEST` listing the invalid paths. |
| FR-WORKSPACE-024 | IF `createMissingDirs` is true and a provided path is missing, the system SHALL dispatch a `CREATE_DIR_REQUEST` to the daemon with duplicate paths deduplicated, and SHALL reject with `BAD_REQUEST` if directory creation fails. |
| FR-WORKSPACE-030 | WHEN `workspace.create` succeeds, the system SHALL scaffold the workspace directory with `workspace.yaml`, `system/overview.md`, `system/features/`, `system/technical/`, `projects/`, `docs/`, and the full `memory/` hierarchy (five subtype dirs plus `sources/` and `references/`), each with a seeded `README.md` containing `<!-- INDEX START -->` / `<!-- INDEX END -->` markers. |
| FR-WORKSPACE-040 | WHEN `workspace.create` succeeds, the system SHALL insert a Default project (`slug: "default"`, `isDefault: true`) and initialise its project directory; IF directory scaffold or default project initialisation fails, the system SHALL delete any partially created directory and the DB row before throwing. |
| FR-WORKSPACE-050 | WHEN `workspace.create` succeeds, the system SHALL call `ensureGitRepo` on the workspace directory — initialising a git repo with `user.name`, `user.email`, `commit.gpgsign=false`, and an initial commit — unless a `.git` already exists; failure of `ensureGitRepo` SHALL be non-fatal (logged as a warning). |
| FR-WORKSPACE-060 | WHEN any workspace mutation (create, update, delete) completes, the system SHALL send a `WORKSPACES_SYNC` WebSocket message to the daemon (if connected) containing the full current workspace list with `slug`, `repos`, and `docsDir` for each workspace. |
| FR-WORKSPACE-070 | WHEN `workspace.update` is called with a new slug, the system SHALL validate the slug format and uniqueness, rename the on-disk directory (when `docsDir` is null), and fully roll back the DB update and re-sync `workspace.yaml` and `WORKSPACES_SYNC` to the pre-update state if the rename fails. |
| FR-WORKSPACE-080 | WHEN `workspace.update` is called with `containerEnabled` transitioning from false to true while `executionBackend` is `devcontainer` (or unset, which defaults to `devcontainer`) and `docsDir` is set, the system SHALL dispatch `DEVCONTAINER_CONFIG_GENERATE_REQUEST` fire-and-forget; failure of this dispatch SHALL be non-fatal (logged as a warning). |
| FR-WORKSPACE-090 | WHEN `workspace.get` is called, the system SHALL return the workspace row augmented with a computed `combinedWorktrees` field that is `false` when `splitWorktrees` is true or when `docsDir` is nested inside one of the workspace's `repos` paths, and `true` otherwise. |
| FR-WORKSPACE-100 | WHEN `workspace.delete` is called, the system SHALL remove the workspace DB row (cascading to all associated projects), attempt to remove the workspace directory (non-fatal on failure), and return `{ success: true }`; IF the workspace id does not exist, the system SHALL throw `NOT_FOUND`. |
| FR-WORKSPACE-110 | The system SHALL expose `listWorkspaces`, `getWorkspaceDetails`, `listProjects`, and `getProjectDetails` as read-only MCP discovery tools; `getWorkspaceDetails` and `getProjectDetails` SHALL return an `mcpError` for an unknown id, while `listProjects` SHALL return an empty array (not an error) for a workspace with no projects. |
| FR-WORKSPACE-115 | WHEN `setWorkspaceEarsBdd` is called, the system SHALL update `earsBdd` on the workspace row and rewrite `workspace.yaml` to match, returning an `mcpError` for an unknown workspace id. |
| FR-WORKSPACE-120 | WHEN `backfillM7` is called for a workspace whose `memory/README.md` is absent, the system SHALL create the full `memory/` hierarchy (five subtype dirs plus `sources/`, `references/`, and all READMEs), append `.qmd/` to `.gitignore` (without corrupting existing content), run the indexer, and commit only the newly added files with `memory(init): backfill knowledge-layer directories`; a second call on an already-migrated workspace SHALL create no additional commit. |
| FR-WORKSPACE-130 | WHEN `workspace.create` or `workspace.update` receives `defaultAgentType`, the system SHALL validate it against the agent-type registry (rejecting unknown values) and persist it; `workspace.create` SHALL default it to `claude` when absent, and `workspace.update` SHALL preserve the existing value when the field is omitted. |

## Sources

No prior knowledge found.
