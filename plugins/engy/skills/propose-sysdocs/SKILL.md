---
name: engy:propose-sysdocs
description: This skill should be used when the user asks to "propose system docs", "update system docs", "refresh system docs", or "surface project knowledge to system docs".
---

# Propose System Docs

Terminal skill that analyzes completed project work and promoted memories, then proposes system doc updates by writing files directly to `{workspaceDir}/system/`. Changes are uncommitted — the user reviews them in the diff viewer's "Latest Changes" mode and approves (commits) or rejects (reverts).

## MCP Tools

- `listWorkspaces` — discover workspaceId when not in context
- `getWorkspaceDetails` — resolve workspace paths, repos list
- `getProjectDetails` — resolve project context and filesystem paths
- `listTasks` — fetch completed tasks
- `listMemories` — fetch promoted permanent memories
- `search` — find relevant existing system docs (skip gracefully if the workspace has no system collection yet)

## Process

### Step 1: Resolve Context

Identify the active workspace and project from the current session/route context:

- If `workspaceId` / `projectId` are available from context, use them.
- Otherwise call `listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `getProjectDetails({ projectId })` to get the project name, `workspaceId`, workspace slug, and filesystem paths (`paths.systemDir`, `paths.workspaceDir`).
- Call `getWorkspaceDetails({ workspaceId })` for the top-level `repos[]` array — `getProjectDetails` returns only `workspace: { id, name, slug }` and does **not** include `repos`.

`systemDir` = `{workspaceDir}/system/`

### Step 2: Read Project Context

Run these in parallel:

**Completed tasks:**

```
listTasks({ projectId, status: 'done', compact: false })
```

Also fetch any tasks with status `'review'` or `'in_progress'` to include in-progress context. (The `tasks` status enum is `backlog | todo | in_progress | review | done` — there is no `active` status; that value belongs to task groups, not tasks.)

**Permanent memories:**

```
listMemories({ workspaceId, scope: 'permanent', compact: false })
```

With `scope: 'permanent'` this returns a **wrapped object** `{ permanent: Memory[] }` — read `result.permanent` for the array (only the legacy `scope: 'fleeting'` returns a bare array). These are the workspace's distilled permanent notes, the raw material to surface as system docs.

**Existing system docs:**

List the contents of `systemDir` using the Read tool. Read any existing files relevant to the project's domain. If `search` is available:

```
search({ workspaceId, query: '<project summary or focus area>', collection: 'system', limit: 10 })
```

Use search results to scope which existing docs to read in full.

### Step 3: Dispatch Research Subagent

Invoke the `engy:research` subagent to gather prior decisions and supporting notes for the project's domain:

```
Task({
  subagent_type: 'engy:research',
  prompt: 'Find prior decisions, patterns, and conventions relevant to: <project name + one-sentence summary of completed work> — context: workspaceId=<workspaceId>, workspace=<slug>, repos=<repos[]>, milestone=<milestoneRef of the work, if known>'
})
```

The `engy:research` agent **requires the numeric `workspaceId`** in the prompt (it errors with `Error: workspaceId missing from prompt` if absent) — pass the integer from Step 1, not the slug. For `milestone`, use a `milestoneRef` value taken from the fetched tasks if one is relevant, or omit the token (no tool returns a `latestMilestoneRef` field).

The subagent returns a `## Findings` digest with cited sources. Hold this digest for Step 4.

If the project has distinct domains (e.g., data model changes + UI changes), run a separate Task call per domain and merge the digests.

If the digest reports no results — the body line `No relevant prior knowledge found for this question.` or the footer `Distinct findings: 0 (after dedup)` — proposed docs must omit the `<!-- engy:research synthesized <YYYY-MM-DD> -->` ... `<!-- /engy:research -->` marker block in Step 5 and instead note `No prior knowledge found.` inline within the `## Sources` section.

### Step 4: Analyze Gaps

If `listMemories` returned zero permanent memories **and** the research digest reported no findings **and** there are no completed tasks with actionable signal, there is nothing to surface: print `No new knowledge to surface — system docs are up to date.` and exit without writing any files.

Otherwise, based on completed tasks + promoted memories + research digest, identify what is missing or outdated in `{workspaceDir}/system/`:

- **New feature doc needed** — a completed feature has no corresponding `system/features/<name>.md`
- **Existing feature doc outdated** — behavior changed, new edge cases emerged, or a promoted memory contradicts or extends the current doc
- **Architectural decision worth capturing** — a significant design choice made during the project (from tasks or memories) belongs in `system/technical/<topic>.md`
- **Cross-references to add** — `scenarioIds`, `linkedMemories`, or `memoryRefs` frontmatter missing from existing docs

Discard trivial changes (typos, minor wording) — only propose docs that carry actionable signal for future work. Every file path, table/column name, tool name, or API symbol you write into a doc must be one you confirmed against the code in this run — do not copy claims from `CLAUDE.md` or sibling docs without verifying, as those can be stale.

### Step 5: Propose Changes

Write proposed updates directly to `{workspaceDir}/system/` using the Write or Edit tool. **Do not write to any other directory.**

**For new files** — create with this frontmatter and structure:

```markdown
---
description: <one-line summary of what this doc covers>
order: <integer>          # reading position within this directory (lower = earlier)
memoryRefs:               # optional — omit entirely if no supporting memories
  - memory/<path-to-supporting-memory>.md
  - memory/<path-to-another-memory>.md
scenarioIds:
  - FR-X.Y
---

# <Feature or Topic Name>

<Body content — overview, behavior, edge cases, constraints, examples>

## Sources

<!-- engy:research synthesized <YYYY-MM-DD> -->
<Inline citations from the research digest — title + citation path for each relevant finding>
<!-- /engy:research -->
```

**Assign or maintain `order:`** — for new docs, slot them sensibly relative to existing ones in the same directory (read the other files' `order:` values first and choose an integer that fits the intended reading position). For edits to existing files, preserve the existing `order:` unless reordering is the intent of the edit.

**Ensure each target directory has a `README.md`** — if `system/features/README.md` or `system/technical/README.md` (whichever contains the new/edited doc) does not yet exist, create it now with a `description:` frontmatter (the directory's blurb in the parent index), a 1–3 sentence prose intro, and the empty index markers:

```markdown
---
description: <one-line summary of what this directory holds>
---

<1–3 sentence prose intro>

<!-- INDEX START -->
<!-- INDEX END -->
```

Do not hand-write links between the markers — the link list is populated by reindex.

**For edits to existing files** — read the file first, apply the minimum change needed, write back. Add or update:
- `memoryRefs[]` frontmatter with memory paths that support the change (not `sources[]` — that key is reserved for ingestion-snapshot paths in the memory schema)
- A `## Sources` section (or update the existing one) with research digest citations

Use the built-in Write tool with an absolute path. Read the existing file via Read first if editing.

### Step 5b: Reindex

After all doc files and READMEs are written, call:

```
reindex({ workspaceId, collection: 'system' })
```

This is a required step — it populates the `<!-- INDEX START --> ... <!-- INDEX END -->` blocks in the directory READMEs with an ordered link list and refreshes the search index for the `system` collection.

### Step 6: Print Summary

After writing all proposed files, print:

```
System doc proposal complete.

Files proposed:
  NEW     system/features/auth.md          — captures new OAuth2 flow added in m3 (memory: decisions/20250501-oauth-choice.md)
  EDIT    system/technical/db-schema.md    — adds nullable `promotedAt` column edge case (memory: decisions/20250430-schema-migration.md)
  NEW     system/technical/ws-protocol.md  — documents REGISTER handshake race condition fix

Research digest: <N> findings from <N> sources walked.

Review changes in the diff viewer (Latest Changes mode), then commit or revert.
```

Each line includes: disposition (NEW / EDIT), relative path, one-line rationale, and the supporting memory path if applicable.

## Key Principles

- **Scope only `system/`** — never write to `docs/`, `memory/`, `projects/`, or anywhere outside `{workspaceDir}/system/`.
- **No automatic commit** — writes land as working-tree changes for the user to review.
- **Cite sources** — every proposed doc must reference the memory or research finding that motivated it.
- **LLM analysis is in-context** — gap analysis runs in the main agent; no extra server-side LLM call beyond the `engy:research` subagent dispatch.
- **Read before writing** — always read an existing file fully before editing it.
- **Minimal diffs** — prefer targeted edits over full rewrites for existing docs.

## Flow Position

**Typical trigger:** after `/engy:review-memories` promotes key memories at project close, or standalone when the user wants to refresh system docs.

**Next step (optional):** commit the proposed changes after review.
