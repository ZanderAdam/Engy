---
name: engy:write-sysdocs
description: This skill should be used when the user asks to "bootstrap/generate/initialize system docs", "propose/update/refresh system docs", "edit/fix/browse a system doc", or "surface project knowledge to system docs". Dispatches in one of three modes depending on intent.
---

# Write System Docs

One editing engine for workspace system documentation — prose overview and technical docs under `{workspaceDir}/system/` — with a mode switch on where the work-list comes from. Writes are always uncommitted; git + the diff viewer are the review surface.

When any mode would create or update a doc under `system/features/`, delegate to `engy:feature-docs` instead of writing it here. Feature docs are owned exclusively by `engy:feature-docs`.

## Modes

| Mode | When to use | Work-list source |
|---|---|---|
| `init` | Empty or sparse `system/` tree | Codebase discovery via Glob/Grep/Read |
| `refresh` | After project completion or memory review | Completed tasks + promoted memories |
| `interactive` | User browses or edits one doc at a time | User input, one doc per turn |

Select the mode from the user's phrasing (see trigger phrases in description) or ask when ambiguous. See `references/` for per-mode detail.

## MCP Tools

- `listWorkspaces` — discover workspaceId when not in context
- `getWorkspaceDetails` — resolve `paths.workspaceDir`, `paths.systemDir`, and `repos[]`
- `getProjectDetails` — resolve project context (refresh mode only)
- `listTasks` — fetch completed tasks (refresh mode only)
- `listMemories` — fetch promoted permanent memories (refresh mode only)
- `search` — find relevant existing system docs (skip gracefully if collection not yet available)

All codebase reads use **Glob**, **Grep**, and **Read** against absolute paths in `repos[]`. All doc writes use **Write** or **Edit** against absolute paths under `{workspaceDir}/system/`. The MCP server does not expose file IO.

## Shared Engine

All three modes run through the same engine:

### Step 1: Resolve Workspace

Obtain `workspaceId` from context or via `listWorkspaces`. Call `getWorkspaceDetails({ workspaceId })` to obtain `paths.workspaceDir`, `paths.systemDir`, and `repos[]`.

`systemDir` = `{workspaceDir}/system/`

### Step 2: Build Work-List

Dispatch to the mode-specific work-list step. See:
- [`references/init-mode.md`](references/init-mode.md) — codebase discovery
- [`references/refresh-mode.md`](references/refresh-mode.md) — tasks + memories gap analysis
- [`references/interactive-mode.md`](references/interactive-mode.md) — user-driven file selection

The mode-specific step returns a set of proposed creates/edits scoped to `system/overview.md` and `system/technical/`. If any item in the work-list targets `system/features/`, emit a handoff:

> This is a feature area — running /engy:feature-docs for `<area>`.

Then invoke `engy:feature-docs` via `Skill({ skill: 'engy:feature-docs' })` for that item and remove it from the work-list. Continue with the remaining (non-feature) items using the engine below.

### Step 3: Dispatch Research Subagent

For each non-trivial create or edit in the work-list, dispatch the `engy:research` subagent:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<topic> — context: workspaceId=<workspaceId>, workspace=<slug>, repos=<repos[]>'
})
```

The `engy:research` agent **requires the numeric `workspaceId`** in the prompt (it errors with `Error: workspaceId missing from prompt` if absent) — pass the integer from Step 1, not the slug.

The subagent returns a `## Findings` digest with cited sources. Hold the digest for Step 4.

If the digest reports no results — the line `No relevant prior knowledge found for this question.` or footer `Distinct findings: 0 (after dedup)` — omit the `<!-- engy:research -->` marker block from the doc and write `No prior knowledge found.` inline under `## Sources` instead (no `memoryRefs:` frontmatter key either).

If the work spans distinct domains (e.g., backend + frontend), run one Task call per domain and merge the digests.

### Step 4: Propose and Write

Apply the work-list using the doc format defined in [`references/doc-format.md`](references/doc-format.md).

- **Interactive mode:** show a before/after diff (or content preview for new files) and wait for explicit user approval before writing. Never write silently.
- **Init and refresh modes:** write directly — changes are uncommitted and visible in the diff viewer.

Confirm every write path stays inside `systemDir`. In interactive mode, resolve with `realpath -m` via Bash and refuse any path whose canonical form escapes `systemDir`.

After writing all docs, ensure each affected directory has a `README.md` with the empty index markers. See `references/doc-format.md` for the README template.

### Step 5: Reindex

After all writes:

```
reindex({ workspaceId, collection: 'system' })
```

This populates `<!-- INDEX START --> ... <!-- INDEX END -->` blocks in each README with an ordered link list and refreshes the search index for the `system` collection.

### Step 6: Print Summary

Print a summary of all files written (disposition, path, one-line rationale) and remind the user: "Changes are uncommitted — review in the diff viewer, then commit or revert."

## Key Principles

- **Scope only `system/overview.md` and `system/technical/`** — feature docs (`system/features/`) are owned by `engy:feature-docs`; delegate and do not write them here.
- **Write in place, never `.draft`** — overwrites are uncommitted working-tree changes; the diff viewer and git are the safety net.
- **No automatic commit** — writes land as working-tree changes for the user to review.
- **Cite sources** — when research findings inform a doc, cite inline under `## Sources`. When there are none, say so explicitly.
- **Read before editing** — always Read an existing file in full before proposing an edit.

## Flow Position

**Init:** starting a new workspace or when `{workspaceDir}/system/` is empty or sparse.

**Refresh:** after `/engy:review-memories` promotes key memories at project close, or standalone when the user wants to refresh system docs.

**Interactive:** incrementally updating system docs as the codebase evolves, or after `init` to refine generated content one file at a time.

**Related:** `/engy:feature-docs` — sole owner of `system/features/<area>.md`.
