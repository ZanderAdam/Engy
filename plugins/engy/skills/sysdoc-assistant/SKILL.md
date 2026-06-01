---
name: engy:sysdoc-assistant
description: "This skill should be used when the user asks to 'edit system docs', 'update a system doc', 'open the sysdoc assistant', 'browse system documentation', or 'fix a system doc'."
---

# System Doc Assistant

Interactive skill for browsing and editing the workspace's system documentation. Scoped exclusively to `{workspaceDir}/system/`. Writes are uncommitted — the user reviews changes in the diff viewer before committing.

Unlike `/engy:propose-sysdocs` (which proposes a batch of updates after project completion), this skill works on **one doc at a time** with the user driving each edit.

## MCP Tools

- `listWorkspaces` — discover workspaceId when not in context
- `getWorkspaceDetails` — resolve workspace paths (`paths.workspaceDir`, `paths.systemDir`)
- `search` — find relevant existing system docs by topic _(skip gracefully if not yet available)_

All file operations use **built-in tools** (Glob, Read, Write, Edit, and Bash for the canonical-path check below) against absolute paths under `{workspaceDir}/system/`. The MCP server does not expose file IO — tRPC procedures are not callable from this context.

## Process

### Step 1: Resolve Workspace

Identify the active workspace from session/route context:

- If `workspaceId` is available from context, use it.
- Otherwise call `listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `getWorkspaceDetails({ workspaceId })` to get `paths.workspaceDir` and `paths.systemDir`.

Set `systemDir = paths.systemDir` (= `{workspaceDir}/system/`).

**Scope rule (load-bearing):** before every Read/Write/Edit, resolve the target path to its canonical form and confirm it stays inside `systemDir`. Run the check with the Bash tool so symlinks and `..` segments are actually resolved — a string-prefix check on the raw input is not sufficient:

```
Bash({ command: 'realpath -m "<targetPath>"' })   # then verify the output begins with <systemDir>
```

Refuse any path whose canonical form escapes `systemDir` — including `..` segments that traverse above it and symlinks whose final target is outside `system/`. For non-system context (codebase files, memories, project specs), use Read/Glob directly on those paths, never proxy them through this skill's edit flow.

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

If Glob returns nothing, the `system/` tree is empty (rare — `init.ts` seeds `system/overview.md` on workspace creation, so this only happens for an externally-managed or corrupted workspace dir): suggest running `/engy:bootstrap-sysdocs` first and exit.

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
- **Reorder docs** — pure reordering means updating `order:` values on the affected files and calling `reindex({ workspaceId, collection: 'system' })` to regenerate the README index; no body content changes needed

If the request is ambiguous, ask one clarifying question before proceeding.

### Step 5: Dispatch Research Subagent (when context warrants)

For non-trivial edits — especially those touching architectural decisions, inter-system dependencies, or historical context — dispatch the `engy:research` subagent to gather prior decisions and supporting notes:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<topic of the edit> — context: workspaceId=<workspaceId>, workspace=<slug>, doc=<relative path>, intent=<user request summary>'
})
```

The `engy:research` agent **requires the numeric `workspaceId`** in the prompt (it errors with `Error: workspaceId missing from prompt` if absent) — pass the integer from Step 1, not the slug. If the digest reports no results (the line `No relevant prior knowledge found for this question.` or footer `Distinct findings: 0 (after dedup)`), simply add no citations to the edit.

Fold the returned `## Findings` digest into the proposed edit as inline citations. Skip this step for straightforward factual corrections or wording improvements.

### Step 6: Propose and Apply Edit

1. Show the user a **before/after diff** (or, for new files, a content preview) of the proposed change. Never write silently.
2. On user approval, apply the change with built-in Edit (existing file) or Write (new file). Per the scope rule in Step 1, the `file_path` must be an absolute path under `${systemDir}`.
   - **For new files:** include an `order:` integer in the frontmatter (slot it relative to existing docs in the same directory — read their `order:` values first). Also ensure the target directory has a `README.md`; create it if missing with a `description:` frontmatter (its blurb in the parent index), a 1–3 sentence prose intro, and the empty index markers (do not populate links between them):
     ```markdown
     ---
     description: <one-line summary of what this directory holds>
     ---

     <1–3 sentence prose intro>

     <!-- INDEX START -->
     <!-- INDEX END -->
     ```
3. If the edit adds a new doc, removes a doc, or changes any `order:` values, call `reindex({ workspaceId, collection: 'system' })` after writing to refresh the README index blocks and update the search index.
4. Confirm the write and remind the user: "Change is uncommitted — review it in the diff viewer when ready."

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
