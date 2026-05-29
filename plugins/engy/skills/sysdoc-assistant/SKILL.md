---
name: engy:sysdoc-assistant
description: Interactive editor for system docs. Browses the system doc tree, opens files, dispatches engy:research for context, and assists with focused content updates one doc at a time.
---

# System Doc Assistant

Interactive skill for browsing and editing the workspace's system documentation. Scoped exclusively to `{workspaceDir}/system/`. Writes are uncommitted — the user reviews changes in the diff viewer before committing.

Unlike `/engy:propose-sysdocs` (which proposes a batch of updates after project completion), this skill works on **one doc at a time** with the user driving each edit.

## MCP Tools

- `mcp__Engy__listWorkspaces` — discover workspaceId when not in context
- `mcp__Engy__getWorkspaceDetails` — resolve workspace paths (`paths.workspaceDir`, `paths.systemDir`)
- `mcp__Engy__search({ workspaceId, query, collection: 'system', limit: 10 })` — find relevant existing system docs by topic _(skip gracefully if not yet available)_

All file operations use **built-in tools** (Glob, Read, Write, Edit) against absolute paths under `{workspaceDir}/system/`. The MCP server does not expose file IO — tRPC procedures are not callable from this context.

## Process

### Step 1: Resolve Workspace

Identify the active workspace from session/route context:

- If `workspaceId` is available from context, use it.
- Otherwise call `mcp__Engy__listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `mcp__Engy__getWorkspaceDetails({ workspaceId })` to get `paths.workspaceDir` and `paths.systemDir`.

Set `systemDir = paths.systemDir` (= `{workspaceDir}/system/`).

**Scope rule (load-bearing):** every Read/Write/Edit path in this skill must resolve to an absolute path starting with `${systemDir}`. Refuse anything else, even if the user requests it. For non-system context (codebase files, memories, project specs), use Read/Glob directly on those paths, never proxy them through this skill's edit flow.

### Step 2: List Existing System Docs

Enumerate all markdown files under `systemDir` with built-in Glob:

```
Glob({ pattern: `${systemDir}/**/*.md` })
```

Present the tree to the user, grouped by subdirectory:

```
system/
  overview.md
  features/
    authentication.md
    task-management.md
  technical/
    data-storage.md
    websocket-protocol.md
```

If Glob returns nothing, the `system/` tree is empty — suggest running `/engy:bootstrap-sysdocs` first and exit.

### Step 3: Select a File to Edit

Ask the user which doc to work on:

- **Existing file** — user picks from the list (or supplies a path).
- **New file** — user provides a name/path. Confirm it fits the `features/` or `technical/` convention.

For an existing file, read it in full with built-in Read before proposing any edits:

```
Read({ file_path: `${systemDir}/<relative-path>.md` })
```

### Step 4: Understand the Edit Request

Ask the user what they want to change or add. Common intents:

- Update a section to reflect new implementation details
- Add a missing feature doc
- Correct an outdated architectural description
- Improve clarity, structure, or cross-references

If the request is ambiguous, ask one clarifying question before proceeding.

### Step 5: Dispatch Research Subagent (when context warrants)

For non-trivial edits — especially those touching architectural decisions, inter-system dependencies, or historical context — dispatch the `engy:research` subagent to gather prior decisions and supporting notes:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<topic of the edit> — context: workspace=<slug>, doc=<relative path>, intent=<user request summary>'
})
```

Fold the returned `## Findings` digest into the proposed edit as inline citations. Skip this step for straightforward factual corrections or wording improvements.

### Step 6: Propose and Apply Edit

1. Show the user a **before/after diff** (or, for new files, a content preview) of the proposed change. Never write silently.
2. On user approval, apply the change with built-in Edit (existing file) or Write (new file). Per the scope rule in Step 1, the `file_path` must be an absolute path under `${systemDir}`.
3. Confirm the write and remind the user: "Change is uncommitted — review it in the diff viewer when ready."

### Step 7: Continue or Exit

After each edit, ask: "Anything else to update in the system docs?"

- **Yes** — return to Step 3 (file selection).
- **No** — close with a summary of all files changed in this session and the next step ("Review and commit changes in the diff viewer").

## Key Principles

- **One doc at a time** — this skill is interactive and focused. Do not bulk-write multiple files in one turn. For batch proposals, point the user at `/engy:propose-sysdocs`.
- **Read before writing** — always Read an existing file in full before proposing an Edit.
- **Show before writing** — always present a diff or content preview and wait for explicit approval before calling Write or Edit.
- **Uncommitted writes** — never commit during this skill. The user controls when changes land via the diff viewer.
- **Consistency check** — when editing a feature doc, note any related technical docs that may now diverge and flag them to the user (do not silently edit them).
- **Cite sources** — when an edit is informed by a research digest, preserve inline citations in the doc so future readers can trace the reasoning.

## Flow Position

**Use when:** Incrementally updating system docs as the codebase evolves, or after `/engy:bootstrap-sysdocs` to refine generated content one file at a time.

**Related:**
- `/engy:bootstrap-sysdocs` — initial generation of the `system/` tree.
- `/engy:propose-sysdocs` — batch proposals after project completion (non-interactive).
