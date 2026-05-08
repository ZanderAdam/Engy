---
name: engy:sysdoc-assistant
description: Interactive editor for system docs. Navigates the system doc tree, opens files, dispatches engy:research for context, and assists with content updates.
---

# System Doc Assistant

An interactive skill for browsing and editing the workspace's system documentation. Scoped exclusively to `{workspaceDir}/system/`. Writes are uncommitted — the user reviews changes in the diff viewer before committing.

## MCP Tools

- `getWorkspaceDetails(workspaceId)` — resolve `workspaceDir`

## tRPC Tools (for file operations)

- `dir.list({ dirPath })` — list subdirectories and files at a path
- `dir.listFiles({ dirPath })` — list all markdown files recursively
- `dir.read({ dirPath, filePath })` — read a specific file
- `dir.write({ dirPath, filePath, content })` — write a file (uncommitted)

## Step 1: Resolve Workspace

1. Identify the active workspace from session context.
2. Call `getWorkspaceDetails(workspaceId)` to get `workspaceDir`.
3. Set the working root to `{workspaceDir}/system/`. All file operations in this skill are scoped to this directory — never read or write outside it.

## Step 2: List Existing System Docs

1. Call `dir.listFiles({ dirPath: '{workspaceDir}/system/' })` to enumerate all existing docs.
2. Present the tree to the user:

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

If the `system/` directory is empty or does not exist, suggest running `/engy:bootstrap-sysdocs` first.

## Step 3: Select a File to Edit

Ask the user which doc to work on:
- **Existing file**: user picks from the list (or types a path)
- **New file**: user provides a name/path — confirm it fits the `features/` or `technical/` convention before creating

Read the selected file in full before presenting it or making any edits.

## Step 4: Understand the Edit Request

Ask the user what they want to change or add. Common intents:
- Update a section to reflect new implementation details
- Add a missing feature doc
- Correct an outdated architectural description
- Improve clarity or structure

If the request is ambiguous, ask one clarifying question before proceeding.

## Step 5: Research Context (when helpful)

For non-trivial edits — especially those touching architectural decisions, inter-system dependencies, or historical context — dispatch the `engy:research` subagent:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<specific topic of the edit> — context: workspace=<slug>, doc=<file path>'
})
```

Fold relevant findings into the proposed edit as inline citations. Skip research for straightforward factual corrections.

## Step 6: Propose and Apply Edit

1. Show the user a **before/after diff** of the proposed change before writing.
2. On user approval, write the updated file via `dir.write({ dirPath, filePath, content })`.
3. Confirm the write and remind the user: "This change is uncommitted — review it in the diff viewer when ready."

For new files, confirm the proposed path and content structure before writing.

## Step 7: Continue or Exit

After each edit, ask: "Anything else to update in the system docs?" 
- If yes, return to Step 3 (file selection).
- If no, close with a summary of all files changed in this session and next steps (e.g., "Review and commit changes in the diff viewer").

## Key Principles

- **System scope only.** Never read or write files outside `{workspaceDir}/system/`. If the user asks about codebase files, use Read/Glob directly — do not proxy through dir tools.
- **Show before writing.** Always present a diff or content preview before calling `dir.write`. Never write silently.
- **Uncommitted writes.** Never commit during this skill. The user controls when changes land.
- **Consistency.** When editing a feature doc, check that related technical docs remain consistent and flag any divergence to the user.

## Flow Position

**Use when:** Incrementally updating system docs as the codebase evolves, or after `/engy:bootstrap-sysdocs` to refine generated content.
**Related:** `/engy:bootstrap-sysdocs` (initial generation), `/engy:propose-sysdocs` (post-project-completion proposals).
