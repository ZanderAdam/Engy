---
title: Spec Authoring
status: complete
---

# Plan: M2 Spec Authoring

## Context

M1 built the foundational skeleton: two running processes (web + client daemon) communicating over WebSocket, SQLite/Drizzle schema with 10 tables, tRPC API, MCP server, and a navigation shell with empty-state tabs. M2 delivers the first real usable feature — the spec writing and browsing experience. Users can create specs, write in a rich markdown editor, organize context files, leave inline comments, and track spec research tasks.

This plan also incorporates a workspace config enhancement: a per-workspace **docs directory** that lets users store workspace files (specs/, docs/, system/, memory/) at a custom path (e.g., inside their repo) rather than in `ENGY_DIR`. This is foundational infrastructure needed before building spec file operations.

> **Design note (docsDir):** The vision spec describes a *global* `.engy/` directory setting. This plan instead implements docsDir as a *per-workspace* field because different workspaces often live in different repos and need their knowledge files co-located with their code. The global ENGY_DIR continues to serve as the default location and home of the SQLite database.

Boundary: no terminal panel (M4), no diff viewer (M5), no feedback routing to agents (M5), no project creation from specs (M3), no async agent auto-start (M9).

---

## New/Modified File Map

```
web/src/
├── server/
│   ├── db/
│   │   ├── schema.ts                          # MODIFY: add docsDir to workspaces table
│   │   └── migrations/                        # NEW: migration for docsDir column
│   ├── engy-dir/
│   │   └── init.ts                            # MODIFY: support custom docsDir
│   ├── spec/
│   │   ├── frontmatter.ts                     # NEW: YAML frontmatter parse/serialize
│   │   ├── frontmatter.test.ts                # NEW
│   │   ├── service.ts                         # NEW: spec filesystem CRUD
│   │   ├── service.test.ts                    # NEW
│   │   ├── watcher.ts                         # NEW: handle daemon FILE_CHANGE for specs
│   │   └── watcher.test.ts                    # NEW
│   ├── trpc/
│   │   ├── root.ts                            # MODIFY: add spec + comment routers
│   │   └── routers/
│   │       ├── workspace.ts                   # MODIFY: accept docsDir in create
│   │       ├── spec.ts                        # NEW: spec file tRPC router
│   │       ├── spec.test.ts                   # NEW
│   │       ├── comment.ts                     # NEW: comment tRPC router
│   │       ├── comment.test.ts                # NEW
│   │       └── task.ts                        # MODIFY: add listBySpecId
│   ├── mcp/
│   │   └── index.ts                           # MODIFY: add spec + comment MCP tools
│   └── ws/
│       └── server.ts                          # MODIFY: route FILE_CHANGE for specs/ to watcher
├── app/w/[workspace]/specs/
│   └── page.tsx                               # REPLACE: full Specs tab
├── components/
│   ├── specs/
│   │   ├── spec-tree.tsx                      # NEW: file tree sidebar
│   │   ├── spec-editor.tsx                    # NEW: BlockNote editor wrapper
│   │   ├── spec-frontmatter.tsx               # NEW: status/actions bar
│   │   ├── spec-tasks.tsx                     # NEW: tasks sub-tab
│   │   ├── spec-comments.tsx                  # NEW: inline comment gutter
│   │   ├── create-spec-dialog.tsx             # NEW
│   │   └── create-spec-task-dialog.tsx        # NEW
│   └── ui/                                    # NEW: shadcn components as needed
│       ├── tabs.tsx
│       ├── scroll-area.tsx
│       ├── textarea.tsx
│       ├── dropdown-menu.tsx
│       ├── tooltip.tsx
│       ├── select.tsx
│       └── resizable.tsx
client/src/
│   └── watcher.ts                             # NEW: chokidar-based file watcher for specs/ and repo dirs
common/src/ws/
│   └── protocol.ts                            # NO CHANGE in M2
```

---

## Functional Requirements

### Workspace Docs Directory

1. **`docsDir` field**: Add nullable `docsDir` text column to `workspaces` table. When set, this is the absolute path where the workspace directory lives (containing workspace.yaml, specs/, docs/, system/, memory/). When null, defaults to `{ENGY_DIR}/{slug}/`.

2. **Workspace directory resolution**: New utility `getWorkspaceDir(workspace: { slug: string, docsDir: string | null }): string` — returns `docsDir` if set, otherwise `path.join(getEngyDir(), slug)`. This replaces all hardcoded `path.join(getEngyDir(), slug)` references.

3. **Create workspace with docsDir**: The `workspace.create` tRPC mutation accepts an optional `docsDir` string. When provided: validate the path exists on disk (via daemon `VALIDATE_PATHS_REQUEST`), then initialize the workspace directory at that path instead of `{ENGY_DIR}/{slug}/`. Store `docsDir` in both the DB row and `workspace.yaml`.

4. **workspace.yaml schema update**: Add optional `docsDir` field:
   ```yaml
   name: string
   slug: string
   docsDir: string       # optional, absolute path
   repos:
     - path: string
   ```

5. **Backward compatibility**: Existing workspaces without `docsDir` continue to work exactly as before (default path resolution).

5b. **docsDir immutability**: `docsDir` is set once at workspace creation and cannot be changed. No tRPC mutation should accept `docsDir` as an updatable field. If a `workspace.update` procedure is added in the future, it must explicitly exclude `docsDir` from its input schema.

### Spec File Service

6. **Spec listing**: Given a workspace, read its `specs/` directory and return a tree structure. Each entry: `name` (directory name), `type` (vision|buildable from frontmatter), `status` (from frontmatter), `contextFiles` (list of files in context/).

7. **Spec creation**: Given a workspace and spec name, create directory under `specs/` with `spec.md` (YAML frontmatter: title, status: draft, type) and empty `context/` subdirectory. Buildable specs get auto-numbered prefix (scan existing dirs for highest number, increment). Vision specs use user-provided name.

8. **Spec reading**: Return parsed frontmatter + markdown body + list of context files.

9. **Spec updating**: Write updated spec.md. Validate status transitions: draft → ready → approved → active → completed. The draft → ready transition is blocked if the spec has incomplete tasks (any task with matching `specId` not in `done` status). The approved → active and active → completed transitions are **M3 concerns** — M2 validates they are legal transitions in the state machine but does not trigger them (approved → active is triggered when a project is created from the spec; active → completed when the associated project archives). Vision specs only allow: draft → completed.

10. **Context file CRUD**: List, read, write, delete files in a spec's `context/` subdirectory.

11. **Spec deletion**: Remove spec directory recursively. If tasks with this specId exist, cascade-delete them (tasks are execution state, not permanent knowledge). Log a warning if deleting tasks.

12. **Path safety**: All operations validate paths stay within the workspace's specs/ directory. Traversal attempts rejected.

### Frontmatter

13. **Parse**: Extract YAML frontmatter from `---` delimiters. Return typed `{ title, status, type }`. Missing/invalid frontmatter returns defaults (status: draft, type: buildable).

14. **Serialize**: Given frontmatter object + body, produce valid spec.md content.

### tRPC Spec Router

15. `spec.list` (query): `{ workspaceSlug: string }` → `SpecTreeNode[]`
16. `spec.get` (query): `{ workspaceSlug: string, specSlug: string }` → `{ frontmatter, body, contextFiles }`
17. `spec.create` (mutation): `{ workspaceSlug: string, title: string, type?: 'buildable'|'vision' }` → spec metadata
18. `spec.update` (mutation): `{ workspaceSlug: string, specSlug: string, title?: string, status?: string, body?: string }` → spec metadata
19. `spec.delete` (mutation): `{ workspaceSlug: string, specSlug: string }` → success
20. `spec.readContextFile` (query): `{ workspaceSlug: string, specSlug: string, filename: string }` → content
21. `spec.writeContextFile` (mutation): `{ workspaceSlug: string, specSlug: string, filename: string, content: string }` → success
22. `spec.deleteContextFile` (mutation): `{ workspaceSlug: string, specSlug: string, filename: string }` → success
22b. `spec.lastChanged` (query): `{ workspaceSlug: string }` → ISO timestamp string (from in-memory watcher map). Returns null if no changes detected yet.

### tRPC Comment Router

23. `comment.create` (mutation): `{ workspaceId, documentPath, anchorStart?, anchorEnd?, content }` → comment
24. `comment.list` (query): `{ workspaceId, documentPath }` → comments ordered by anchorStart
25. `comment.update` (mutation): `{ workspaceId, id, content }` → comment. Validates comment belongs to workspace (query by id, assert `workspaceId` matches — per-procedure check, no shared middleware).
26. `comment.resolve` (mutation): `{ workspaceId, id }` → comment. Validates comment belongs to workspace.
27. `comment.unresolve` (mutation): `{ workspaceId, id }` → comment. Validates comment belongs to workspace.
28. `comment.delete` (mutation): `{ workspaceId, id }` → success. Validates comment belongs to workspace.

### Spec Task Extensions

29. `task.listBySpecId` (query): `{ specId: string }` → tasks with matching specId
30. Spec readiness utility: checks all tasks for a specId are done. Used by spec.update lifecycle validation.

### MCP Spec Tools

31. Tools: `createSpec`, `listSpecs`, `getSpec`, `updateSpec`, `readSpecFile`, `writeSpecFile`, `listSpecTasks`, `createSpecTask`. Each delegates to spec service / task router.

### File Watcher

32. **Build daemon file watcher from scratch.** The `FILE_CHANGE` WebSocket message type exists in the protocol and the server already handles it, but the client daemon has no file watching code yet. Add `chokidar` to the client package and implement a watcher that watches each workspace's `specs/` directory (and repo directories). Sends `FILE_CHANGE` messages over WebSocket. When the server receives a `FILE_CHANGE` message for a specs/ path, update an in-memory timestamp per workspace.
33. `spec.lastChanged` tRPC query returns timestamp — UI polls and refetches tree when it changes.
34. Daemon starts watching specs/ dirs on startup (for all workspaces) and on workspace creation. Stops on workspace deletion. No server-side chokidar needed — all file watching runs in the client daemon.

### UI: Specs Tab

35. **Two-panel layout**: Left panel (spec tree, ~280px, resizable) + right panel (content area with sub-tabs).
36. **Spec tree**: Recursive tree from spec.list. Expand/collapse. Status badges. Click to select file. "New Spec" button.
37. **Sub-tabs**: "Content" (default) + "Tasks".
38. **Content editor**: BlockNote rich markdown editor. Loaded via next/dynamic (ssr: false). Markdown round-trip via parse/serialize. Auto-save (1500ms debounce).
39. **Frontmatter bar**: Above editor — title, status badge, type badge, action buttons (Mark Ready, Approve, Create Project → disabled/M3). "Open in VS Code" button.
40. **Inline comments**: Text selection → "Comment" action → popover. Comments displayed in gutter. Resolve/delete actions. Anchored by character offsets. No feedback routing in M2.
41. **Spec tasks**: Flat list with dependency indicators (indented dependents, arrow icons). Checkbox for done/todo toggle. "New Task" dialog (title, type, description). Dependency graph view deferred to M3 when the full graph visualization ships for project tasks.
42. **New Spec dialog**: Title + type fields. Creates spec and selects it.
43. **Vision spec display**: Distinct badge, no lifecycle actions.

---

## Behavioral Requirements

> Each scenario maps to one or more test cases. `FR #N` references the Functional Requirement above.

### Workspace Docs Directory

```gherkin
Feature: Workspace docs directory
  Workspaces can store their file layer at a custom path.

  Scenario: Create workspace with custom docsDir (FR #1, #3)
    Given a valid directory "/home/user/my-repo/docs" exists on disk
    When I create a workspace with name "my-project" and docsDir "/home/user/my-repo/docs"
    Then the workspace DB row has docsDir "/home/user/my-repo/docs"
    And workspace.yaml is created at "/home/user/my-repo/docs/workspace.yaml"
    And the directory structure (specs/, docs/, system/, memory/) exists at that path

  Scenario: Create workspace without docsDir uses default (FR #1, #5)
    When I create a workspace with name "default-project" and no docsDir
    Then the workspace DB row has docsDir null
    And the directory structure exists at "{ENGY_DIR}/default-project/"

  Scenario: Resolve workspace directory with docsDir set (FR #2)
    Given a workspace with slug "my-project" and docsDir "/custom/path"
    When I call getWorkspaceDir(workspace)
    Then it returns "/custom/path"

  Scenario: Resolve workspace directory with docsDir null (FR #2)
    Given a workspace with slug "my-project" and docsDir null
    When I call getWorkspaceDir(workspace)
    Then it returns "{ENGY_DIR}/my-project"

  Scenario: docsDir is stored in workspace.yaml (FR #4)
    Given I create a workspace with docsDir "/custom/path"
    When I read the workspace.yaml file
    Then it contains a docsDir field with value "/custom/path"

  Scenario: docsDir validation rejects nonexistent path (FR #3)
    When I create a workspace with docsDir "/nonexistent/path"
    Then the creation fails with a path validation error

  Scenario: docsDir cannot be changed after creation (FR #5b)
    Given an existing workspace with docsDir "/original/path"
    When any mutation attempts to change docsDir
    Then the mutation rejects the docsDir field

  Scenario: Delete workspace with custom docsDir (FR #1)
    Given a workspace with docsDir "/custom/path"
    When I delete the workspace
    Then the directory at "/custom/path" is removed

  Scenario: Delete workspace validates docsDir path matches stored value (FR #1)
    Given a workspace with docsDir "/custom/path"
    When removeWorkspaceDir resolves the path
    Then the resolved path is validated against the stored docsDir (not against ENGY_DIR)
    And path traversal attempts are rejected
```

### Frontmatter

```gherkin
Feature: Spec frontmatter parsing
  YAML frontmatter in spec.md files drives spec metadata.

  Scenario: Parse valid frontmatter (FR #13)
    Given a spec.md with content:
      """
      ---
      title: Auth Revamp
      status: draft
      type: buildable
      ---
      # Auth Revamp
      Body content here.
      """
    When I call parseFrontmatter(content)
    Then it returns { title: "Auth Revamp", status: "draft", type: "buildable" }
    And the body is "# Auth Revamp\nBody content here."

  Scenario: Missing frontmatter returns defaults (FR #13)
    Given a spec.md with content "# Just a heading"
    When I call parseFrontmatter(content)
    Then it returns { title: "", status: "draft", type: "buildable" }

  Scenario: Invalid YAML returns defaults (FR #13)
    Given a spec.md with malformed YAML between --- delimiters
    When I call parseFrontmatter(content)
    Then it returns defaults without throwing

  Scenario: Round-trip preserves content (FR #14)
    Given a frontmatter object and body text
    When I serialize then parse the result
    Then the frontmatter and body match the originals

  Scenario: Extra frontmatter fields are preserved (FR #13, #14)
    Given a spec.md with an extra field "customField: value" in frontmatter
    When I parse and re-serialize
    Then "customField: value" is still present in the output
```

### Spec File Service

```gherkin
Feature: Spec CRUD operations
  Specs are directories on disk with spec.md + context/.

  Scenario: List specs for a workspace (FR #6)
    Given a workspace with specs/ containing "initial/" (vision) and "1_auth/" (buildable)
    When I call listSpecs(workspace)
    Then it returns two entries with correct names, types, and statuses

  Scenario: Create buildable spec with auto-numbering (FR #7)
    Given a workspace with existing spec "1_auth/"
    When I create a buildable spec with title "Payments"
    Then a directory "2_payments/" is created under specs/
    And it contains spec.md with frontmatter { title: "Payments", status: "draft", type: "buildable" }
    And it contains an empty context/ subdirectory

  Scenario: Create vision spec without numbering (FR #7)
    When I create a vision spec with title "Platform Vision"
    Then a directory "platform-vision/" is created under specs/ (no numeric prefix)
    And its frontmatter has type "vision"

  Scenario: Auto-numbering scans for highest prefix (FR #7)
    Given existing specs "1_auth/", "3_payments/" (gap at 2)
    When I create a buildable spec
    Then its prefix is "4" (highest + 1, not gap-filling)

  Scenario: Read spec returns full content (FR #8)
    Given a spec "1_auth/" with frontmatter, body, and context files ["api-notes.md", "schema.sql"]
    When I call getSpec(workspace, "1_auth")
    Then it returns the parsed frontmatter, markdown body, and contextFiles list

  Scenario: Update spec body (FR #9)
    Given a spec "1_auth/" in draft status
    When I update its body to "New content"
    Then spec.md on disk contains the new body with existing frontmatter preserved

  Scenario: Buildable lifecycle — draft to ready with all tasks done (FR #9)
    Given a spec "1_auth/" in draft status
    And all tasks with specId "1_auth" are in done status
    When I update its status to "ready"
    Then the status is updated to "ready"

  Scenario: Buildable lifecycle — draft to ready blocked by incomplete tasks (FR #9)
    Given a spec "1_auth/" in draft status
    And a task with specId "1_auth" is in todo status
    When I update its status to "ready"
    Then the update fails with "incomplete tasks" error

  Scenario: Buildable lifecycle — ready to approved (FR #9)
    Given a spec "1_auth/" in ready status
    When I update its status to "approved"
    Then the status is updated to "approved"

  Scenario: Buildable lifecycle — approved to active is valid (FR #9)
    Given a spec "1_auth/" in approved status
    When I update its status to "active"
    Then the status is updated to "active"

  Scenario: Buildable lifecycle — invalid transition rejected (FR #9)
    Given a spec "1_auth/" in draft status
    When I update its status to "approved" (skipping ready)
    Then the update fails with "invalid status transition" error

  Scenario: Vision lifecycle — only draft and completed (FR #9)
    Given a vision spec in draft status
    When I update its status to "completed"
    Then the status is updated to "completed"

  Scenario: Vision lifecycle — ready rejected (FR #9)
    Given a vision spec in draft status
    When I update its status to "ready"
    Then the update fails with "invalid status transition" error

  Scenario: Delete spec cascade-deletes tasks (FR #11)
    Given a spec "1_auth/" with 3 associated tasks
    When I delete the spec
    Then the spec directory is removed from disk
    And all 3 tasks with matching specId are deleted from the database

  Scenario: Delete spec with no tasks (FR #11)
    Given a spec "1_auth/" with no associated tasks
    When I delete the spec
    Then the spec directory is removed from disk

  Scenario: Path traversal rejected (FR #12)
    When I attempt to read spec "../../../etc/passwd"
    Then the operation fails with a path safety error

  Scenario: Path traversal in context file rejected (FR #12)
    When I attempt to write context file "../../outside.txt"
    Then the operation fails with a path safety error
```

### Context Files

```gherkin
Feature: Spec context file operations
  Each spec has a context/ subdirectory for supporting files.

  Scenario: List context files (FR #10)
    Given a spec with context/ containing ["notes.md", "diagram.png"]
    When I call listContextFiles(workspace, specSlug)
    Then it returns ["diagram.png", "notes.md"] (sorted)

  Scenario: Read context file (FR #10)
    Given a context file "notes.md" with content "Research notes"
    When I call readContextFile(workspace, specSlug, "notes.md")
    Then it returns "Research notes"

  Scenario: Write new context file (FR #10)
    When I call writeContextFile(workspace, specSlug, "new.md", "Content")
    Then the file exists at specs/{specSlug}/context/new.md with that content

  Scenario: Overwrite existing context file (FR #10)
    Given a context file "notes.md" with content "Old"
    When I call writeContextFile(workspace, specSlug, "notes.md", "New")
    Then the file content is "New"

  Scenario: Delete context file (FR #10)
    Given a context file "notes.md"
    When I call deleteContextFile(workspace, specSlug, "notes.md")
    Then the file no longer exists

  Scenario: Read nonexistent context file (FR #10)
    When I call readContextFile(workspace, specSlug, "missing.md")
    Then it fails with a "file not found" error
```

### tRPC Spec Router

```gherkin
Feature: Spec tRPC API
  tRPC procedures expose spec operations to the UI.

  Scenario: spec.list returns tree for workspace (FR #15)
    Given a workspace "engy" with 2 specs on disk
    When I call spec.list({ workspaceSlug: "engy" })
    Then it returns 2 SpecTreeNode entries

  Scenario: spec.get returns full spec (FR #16)
    Given a spec "1_auth" in workspace "engy"
    When I call spec.get({ workspaceSlug: "engy", specSlug: "1_auth" })
    Then it returns frontmatter, body, and contextFiles

  Scenario: spec.create creates directory on disk (FR #17)
    When I call spec.create({ workspaceSlug: "engy", title: "New Feature", type: "buildable" })
    Then a new spec directory exists under the workspace's specs/
    And it returns the spec metadata

  Scenario: spec.update validates status transition (FR #18)
    Given a spec in "draft" status
    When I call spec.update with status "approved"
    Then it fails (cannot skip "ready")

  Scenario: spec.delete removes directory and cascades tasks (FR #19)
    Given a spec "1_auth" with 2 tasks
    When I call spec.delete({ workspaceSlug: "engy", specSlug: "1_auth" })
    Then the spec directory is removed
    And both tasks are deleted

  Scenario: spec.readContextFile returns file content (FR #20)
    When I call spec.readContextFile with a valid filename
    Then it returns the file content

  Scenario: spec.writeContextFile creates/updates file (FR #21)
    When I call spec.writeContextFile with filename and content
    Then the file exists on disk with that content

  Scenario: spec.deleteContextFile removes file (FR #22)
    When I call spec.deleteContextFile with a valid filename
    Then the file no longer exists
```

### tRPC Comment Router

```gherkin
Feature: Comment tRPC API
  Inline comments on spec documents.

  Scenario: Create comment with anchors (FR #23)
    Given a workspace and document path "specs/1_auth/spec.md"
    When I create a comment with anchorStart 10 and anchorEnd 50
    Then the comment is stored with those anchors

  Scenario: Create comment without anchors (FR #23)
    When I create a comment with no anchor positions
    Then the comment is stored with null anchors (document-level comment)

  Scenario: List comments ordered by anchor (FR #24)
    Given 3 comments on the same document with anchorStart 50, 10, 30
    When I list comments for that document
    Then they are returned in order: anchorStart 10, 30, 50

  Scenario: Update comment validates workspace ownership (FR #25)
    Given a comment belonging to workspace 1
    When I call comment.update with workspaceId 2 and the comment's id
    Then the update fails with an ownership error

  Scenario: Resolve and unresolve comment (FR #26, #27)
    Given an unresolved comment
    When I resolve it
    Then resolved is true
    When I unresolve it
    Then resolved is false

  Scenario: Delete comment validates workspace ownership (FR #28)
    Given a comment belonging to workspace 1
    When I call comment.delete with workspaceId 2
    Then the deletion fails with an ownership error
```

### Spec Tasks

```gherkin
Feature: Spec task management
  Tasks linked to specs via specId.

  Scenario: List tasks by specId (FR #29)
    Given 3 tasks with specId "1_auth" and 2 tasks with specId "2_payments"
    When I call task.listBySpecId({ specId: "1_auth" })
    Then it returns exactly 3 tasks

  Scenario: Readiness check — all tasks done (FR #30)
    Given 2 tasks with specId "1_auth", both in "done" status
    When the readiness check runs for "1_auth"
    Then it returns true

  Scenario: Readiness check — incomplete tasks (FR #30)
    Given 2 tasks with specId "1_auth", one "done" and one "todo"
    When the readiness check runs for "1_auth"
    Then it returns false

  Scenario: Readiness check — no tasks (FR #30)
    Given no tasks with specId "1_auth"
    When the readiness check runs for "1_auth"
    Then it returns true (no tasks = nothing blocking)
```

### MCP Spec Tools

```gherkin
Feature: MCP spec tools
  AI agents access specs through MCP tools.

  Scenario: Create spec via MCP (FR #31)
    When I call MCP tool createSpec with workspaceSlug and title
    Then a spec directory is created on disk
    And the tool returns spec metadata

  Scenario: List specs via MCP (FR #31)
    Given 2 specs exist in the workspace
    When I call MCP tool listSpecs
    Then it returns 2 entries

  Scenario: Get spec via MCP (FR #31)
    When I call MCP tool getSpec with workspaceSlug and specSlug
    Then it returns frontmatter, body, and contextFiles

  Scenario: Write context file via MCP (FR #31)
    When I call MCP tool writeSpecFile with filename and content
    Then the file exists in the spec's context/ directory

  Scenario: Create spec task via MCP (FR #31)
    When I call MCP tool createSpecTask with specId and title
    Then a task is created with the correct specId
```

### File Watcher

```gherkin
Feature: Spec file change detection
  External edits to spec files are detected via daemon FILE_CHANGE messages.

  Scenario: File change updates timestamp (FR #32, #33)
    Given the watcher is active for workspace "engy"
    When a FILE_CHANGE message arrives for "specs/1_auth/spec.md"
    Then the lastChanged timestamp for "engy" is updated

  Scenario: Changes are debounced (FR #32)
    Given the watcher is active for workspace "engy"
    When 5 FILE_CHANGE messages arrive within 100ms
    Then the timestamp is updated only once (after 300ms debounce)

  Scenario: spec.lastChanged returns current timestamp (FR #33)
    Given the lastChanged timestamp for "engy" is "2026-03-01T12:00:00Z"
    When I call spec.lastChanged({ workspaceSlug: "engy" })
    Then it returns "2026-03-01T12:00:00Z"

  Scenario: Watcher starts for new workspace (FR #34)
    When I create a new workspace "new-project"
    Then the daemon begins watching its specs/ directory

  Scenario: Watcher stops on workspace deletion (FR #34)
    Given the watcher is active for workspace "engy"
    When I delete the workspace
    Then the daemon stops watching its specs/ directory
```

---

## Implementation Sequence

> TDD throughout: write failing tests first, then implement.

### Phase 1: Workspace docsDir

**Files**: `web/src/server/db/schema.ts`, `web/src/server/db/migrations/`, `web/src/server/engy-dir/init.ts`, `web/src/server/trpc/routers/workspace.ts`, `web/src/server/trpc/routers/workspace.test.ts`, `web/src/components/create-workspace-dialog.tsx`

1. Add `docsDir` column to workspaces table (nullable text). Generate Drizzle migration.
2. Add `getWorkspaceDir()` utility — returns `docsDir ?? path.join(getEngyDir(), slug)`.
3. Update `initWorkspaceDir(name, slug, repos, docsDir?)` to accept optional `docsDir` param and create directory structure at that path. Write `docsDir` into `workspace.yaml` when set. Refactor workspace.yaml generation to use `js-yaml` (replacing hand-rolled string concatenation) for consistent YAML handling across frontmatter and workspace config.
4. Update `removeWorkspaceDir()` to use the resolved workspace dir. **Security note:** when `docsDir` is set, the resolved path is outside `ENGY_DIR`, so the existing path-within-ENGY_DIR validation must be replaced with a check that the path matches the stored `docsDir` value exactly.
5. Update `workspace.create` tRPC: accept optional `docsDir`, validate path via daemon, pass to init.
6. Update `workspace.get` to return `docsDir` field.
7. Update Create Workspace dialog: add optional "Docs location" field (path input).
8. Update MCP `createWorkspace` tool to accept `docsDir`. Update MCP `getWorkspaceConfig` to parse workspace.yaml with `js-yaml` instead of returning raw text. Update MCP `isPathAllowed()` to also allow paths within a workspace's `docsDir` (when set outside `ENGY_DIR`).
9. Tests: create workspace with docsDir, verify directory created at custom path. Create without docsDir, verify default behavior unchanged. Get workspace returns docsDir.

### Phase 2: Frontmatter Parser

**Files**: `web/src/server/spec/frontmatter.ts`, `web/src/server/spec/frontmatter.test.ts`

10. Pure functions: `parseFrontmatter(content)` and `serializeFrontmatter(frontmatter, body)`.
11. Type: `SpecFrontmatter = { title: string, status: 'draft'|'ready'|'approved'|'active'|'completed', type: 'buildable'|'vision' }`.
12. Tests: valid parse, missing frontmatter defaults, invalid YAML handling, round-trip, extra fields preserved.
13. Dependency: add `js-yaml` + `@types/js-yaml` if not already present.

### Phase 3: Spec File Service

**Files**: `web/src/server/spec/service.ts`, `web/src/server/spec/service.test.ts`

14. Functions: `listSpecs()`, `createSpec()`, `getSpec()`, `updateSpec()`, `deleteSpec()`, `listContextFiles()`, `readContextFile()`, `writeContextFile()`, `deleteContextFile()`.
15. All resolve paths via `getWorkspaceDir()` + `/specs/`. Path traversal validation.
16. Auto-numbering: scan existing directories for highest numeric prefix, increment.
17. Tests: full CRUD (buildable + vision), auto-numbering, path traversal rejection, context file ops, lifecycle validation (full transition chain including active/completed, vision-only transitions, mocked task check for readiness gate), deletion cascade-deletes associated tasks.

### Phase 4: tRPC Spec + Comment Routers

**Files**: `web/src/server/trpc/routers/spec.ts`, `web/src/server/trpc/routers/spec.test.ts`, `web/src/server/trpc/routers/comment.ts`, `web/src/server/trpc/routers/comment.test.ts`, `web/src/server/trpc/root.ts`

18. Spec router: all procedures from FR #15–22. Delegates to spec service. Readiness check queries tasks table.
19. Comment router: all procedures from FR #23–28. Uses existing comments table.
20. Wire both into root.ts.
21. Extend task router: add `listBySpecId` procedure.
22. Tests: integration tests using setupTestDb() + temp filesystem.

### Phase 5: MCP Spec Tools

**Files**: `web/src/server/mcp/index.ts`, `web/src/server/mcp/index.test.ts`

23. Register spec tools: createSpec, listSpecs, getSpec, updateSpec, readSpecFile, writeSpecFile, listSpecTasks, createSpecTask.
24. Follow existing tool patterns (mcpResult/mcpError helpers).
25. Tests: create spec, list, get, write context file, create task.

### Phase 6: Spec File Watcher

**Files**: `client/src/watcher.ts` (NEW), `client/src/watcher.test.ts` (NEW), `client/src/index.ts` (MODIFY), `web/src/server/spec/watcher.ts` (NEW), `web/src/server/spec/watcher.test.ts` (NEW), `common/src/ws/protocol.ts` (NO CHANGE — existing FILE_CHANGE message used)

26. **Client-side (NEW):** Add `chokidar` to client package. Create `client/src/watcher.ts` with a `FileWatcher` class that watches directories and sends `FILE_CHANGE` WebSocket messages. Wire into `client/src/index.ts` — on `WORKSPACES_SYNC`, start watching each workspace's specs/ directory (resolved via the sync payload). Stop watchers on workspace removal. The `FILE_CHANGE` protocol message already exists — no protocol changes needed.
27. **Server-side:** `handleSpecFileChange(workspaceSlug)` — called when a `FILE_CHANGE` message arrives for a specs/ path. Debounce 300ms, updates in-memory timestamp map on AppState.
28. Add `spec.lastChanged` tRPC query — returns timestamp for UI polling.
29. Wire to workspace lifecycle: server broadcasts `WORKSPACES_SYNC` after workspace create/delete (already done), client reacts by starting/stopping watchers.
30. Tests: client watcher unit tests (mock chokidar), server-side file change handling, timestamp updates, debounce behavior.

### Phase 7: UI — shadcn Components + BlockNote

**Files**: `web/src/components/ui/*.tsx`, `web/package.json`

32. Install shadcn: Tabs, ScrollArea, Textarea, DropdownMenu, Tooltip, Select, Resizable.
33. Install shadcn-tree-view: `npx shadcn add "https://mrlightful.com/registry/tree-view"` — provides TreeView component with expand/collapse, selection, icons, and inline actions out of the box.
34. Install BlockNote: `@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn`.

### Phase 8: UI — Spec Tree

**Files**: `web/src/components/specs/spec-tree.tsx`

35. Client component using shadcn-tree-view TreeView. Map spec.list data to `TreeDataItem[]` with: spec dirs as parent nodes (with status badge icons), spec.md and context files as leaf nodes (with file icons). Configure `onSelectChange` to emit selected file. "New Spec" button below tree. Context menu on file nodes with "Open in VS Code" action (invokes `code` CLI with file path).

### Phase 9: UI — Content Editor + Frontmatter

**Files**: `web/src/components/specs/spec-editor.tsx`, `web/src/components/specs/spec-frontmatter.tsx`

36. BlockNote editor loaded via next/dynamic (ssr: false). Markdown → blocks on load, blocks → markdown on save. Auto-save with 1500ms debounce.
37. Frontmatter bar: title, status badge, type badge, action buttons (Mark Ready, Approve, Open in VS Code).

### Phase 10: UI — Comments

**Files**: `web/src/components/specs/spec-comments.tsx`

38. Comment gutter alongside editor. Fetch via comment.list. Comment cards with resolve/delete.
39. Creation: text selection → comment button → popover → submit with anchor offsets.

### Phase 11: UI — Spec Tasks

**Files**: `web/src/components/specs/spec-tasks.tsx`, `web/src/components/specs/create-spec-task-dialog.tsx`

40. Flat task list with dependency indicators. Checkbox toggle (todo/done). Type badges.
41. "New Task" dialog: title, type (AI/Human), description.

### Phase 12: UI — Page Assembly

**Files**: `web/src/app/w/[workspace]/specs/page.tsx`, `web/src/components/specs/create-spec-dialog.tsx`

42. Assemble: Resizable layout → SpecTree (left) + Tabs (Content | Tasks) (right).
43. Content tab: SpecFrontmatter + SpecEditor + SpecComments.
44. Tasks tab: SpecTasks.
45. Empty state when no spec selected.
46. "New Spec" dialog: title + type fields.

### Phase 13: Skills

**Files**: `.claude/skills/engy-spec-assistant.md` (Claude Code skill file, loaded by Claude Code CLI when the user invokes `engy:spec-assistant`)

47. Claude Code skill for spec drafting. References MCP tools (createSpec, writeSpecFile, createSpecTask, etc.). Guides the user through the spec authoring workflow: research → draft → context files → tasks → ready.

### Phase 14: Tooling Polish

48. Knip: no unused exports. jscpd: no duplicates. Coverage: 90%+. `pnpm blt` passes.

---

## Key Decisions

1. **docsDir**: Per-workspace, optional, set at creation time (immutable). Entire workspace dir lives at configured path. Default: `{ENGY_DIR}/{slug}/`.

2. **BlockNote UI**: Use `@blocknote/shadcn` for consistency with existing shadcn component stack. Loaded via next/dynamic with ssr: false.

3. **Markdown as source of truth**: Specs stored as plain markdown + YAML frontmatter on disk. BlockNote JSON NOT used for persistence. Lossy round-trip is acceptable for prose-heavy specs.

4. **Real-time updates**: M2 uses polling (React Query refetchInterval + spec.lastChanged timestamp) rather than WebSocket push to browser. File watching runs in the client daemon via chokidar (new in M2 — the `FILE_CHANGE` protocol message exists from M1 but the watcher implementation is new). No server-side chokidar. Proper browser subscriptions deferred to M4.

5. **Comment anchoring**: Character offsets, static (not adjusted on edits). Acceptable for M2's local annotation use case.

6. **Vision specs**: Only draft + completed status. No lifecycle actions. Displayed as reference documents.

7. **Spec deletion**: Cascade-deletes any tasks with matching specId (tasks are execution state). Logs a warning when tasks are deleted.

8. **Auto-numbering**: Buildable specs get numeric prefix by scanning existing dirs. Vision specs don't.

---

## Out of Scope

| Feature | Milestone |
|---------|-----------|
| Terminal panel / xterm.js | M4 |
| Diff viewer | M5 |
| Feedback routing (batch comments → agent) | M5 |
| Project creation from specs ("Create Project" button rendered but disabled) | M3 |
| Agent auto-start for spec tasks | M9 |
| ChromaDB search indexing | M7 |
| Dependency graph visualization (full graph) | M3 |
| Changing docsDir after workspace creation | Future |

---

## Dependencies to Add

| Package | Target | Purpose |
|---------|--------|---------|
| `@blocknote/core` | web | Editor core |
| `@blocknote/react` | web | React bindings |
| `@blocknote/shadcn` | web | Editor UI theme |
| shadcn-tree-view | web | Spec tree via `npx shadcn add "https://mrlightful.com/registry/tree-view"` |
| `js-yaml` | web | Frontmatter parsing + workspace.yaml read/write |
| `@types/js-yaml` | web (dev) | Types |
| `chokidar` | client | File system watching for specs/ and repo directories |

---

## Verification

1. `pnpm blt` passes (build + lint + test)
2. Create workspace with custom docsDir → verify files at custom path
3. Create workspace without docsDir → verify default behavior
4. Navigate to Specs tab → see two-panel layout
5. Create a spec → directory appears on disk, tree updates
6. Edit spec in BlockNote → auto-saves, re-read shows changes
7. Add context files → appear in tree under spec
8. Create spec tasks → appear in Tasks sub-tab
9. Mark spec as Ready (with all tasks done) → status updates
10. Leave inline comments → persist across page reloads
11. Edit spec in VS Code → watcher detects, UI refreshes on poll
12. MCP tools work from Claude Code CLI: createSpec, listSpecs, etc.
