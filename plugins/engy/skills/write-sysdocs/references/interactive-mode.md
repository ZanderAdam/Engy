# Interactive Mode

User-driven, one doc at a time. Shows a diff before every write and waits for explicit approval. Loop continues until the user says they are done.

## Work-List Step (Step 2 of shared engine)

### Scope Guard (load-bearing)

Before every Read/Write/Edit, resolve the target path to its canonical form and confirm it stays inside `systemDir`. Use Bash so symlinks and `..` segments are actually resolved — a string-prefix check on the raw input is not sufficient:

```
Bash({ command: 'realpath -m "<targetPath>"' })   # then verify the output begins with <systemDir>
```

Refuse any path whose canonical form escapes `systemDir` — including `..` segments that traverse above it and symlinks whose final target is outside `system/`. For non-system context (codebase files, memories, project specs), use Read/Glob directly on those paths; never proxy them through this skill's edit flow.

### List Existing System Docs

Enumerate all markdown files under `systemDir` with Glob:

```
Glob({ pattern: `${systemDir}/**/*.md` })
```

Present the tree to the user, grouped by subdirectory:

```
system/
  overview.md
  features/
    authentication.md
  technical/
    data-storage.md
    websocket-protocol.md
```

If Glob returns nothing, the `system/` tree is empty: suggest running `/engy:write-sysdocs` in init mode first and exit.

### Select a File to Edit

Ask the user which doc to work on:

- **Existing file** — user picks from the list or supplies a path.
- **New file** — user provides a name/path. Confirm it fits the `technical/` convention (or `overview.md`). If the user specifies a path under `features/`, emit the handoff to `engy:feature-docs` and return to file selection.

For an existing file, read it in full with Read before proposing any edits.

### Understand the Edit Request

Ask what the user wants to change or add. Common intents:

- Update a section to reflect new implementation details.
- Add a missing technical doc.
- Correct an outdated architectural description.
- Improve clarity, structure, or cross-references.
- **Reorder docs** — pure reordering means updating `order:` values on the affected files and calling `reindex({ workspaceId, collection: 'system' })` to regenerate the README index; no body content changes needed.

If the request is ambiguous, ask one clarifying question before proceeding.

Return the single-file work-list to the shared engine for Steps 3–6.

## Write Rule (interactive-specific)

In Step 4 of the shared engine, before writing:

1. Show the user a **before/after diff** (or content preview for new files).
2. Wait for explicit approval.
3. On approval, apply with Edit (existing file) or Write (new file).
4. Confirm the write and remind the user: "Change is uncommitted — review it in the diff viewer when ready."

Never write silently.

## Continue or Exit

After each edit:

- Ask: "Anything else to update in the system docs?"
- **Yes** — return to the file-selection step.
- **No** — close with a summary of all files changed in this session and the next step ("Review and commit changes in the diff viewer").

## Key Behaviors

- **One doc at a time** — interactive and focused. Do not bulk-write multiple files in one turn. For batch proposals, point the user at `/engy:write-sysdocs` (refresh mode) instead.
- **Consistency check** — when editing a technical doc, note any related docs that may now diverge and flag them to the user (do not silently edit them).
- **Reindex after structural changes** — if the edit adds a new doc, removes a doc, or changes any `order:` values, call `reindex({ workspaceId, collection: 'system' })` after writing.
