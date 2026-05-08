---
name: engy:propose-sysdocs
description: Propose system doc updates based on the current project's completed tasks and promoted memories. Writes proposed changes to {workspaceDir}/system/, reviewable via the diff viewer's Latest Changes mode.
---

# Propose System Docs

Terminal skill that analyzes completed project work and promoted memories, then proposes system doc updates by writing files directly to `{workspaceDir}/system/`. Changes are uncommitted — the user reviews them in the diff viewer's "Latest Changes" mode and approves (commits) or rejects (reverts).

## MCP Tools

- `mcp__Engy__listWorkspaces` — discover workspaceId when not in context
- `mcp__Engy__getWorkspaceDetails` — resolve workspace paths, repos list
- `mcp__Engy__getProjectDetails` — resolve project context and filesystem paths
- `mcp__Engy__listTasks({ projectId, status: 'done', compact: false })` — fetch completed tasks
- `mcp__Engy__listMemories({ workspaceId, compact: false })` — fetch all fleeting memories (filter client-side for promoted)
- `mcp__Engy__search({ workspaceId, query, collection: 'system', limit: 10 })` — find relevant existing system docs _(available once TG3 search is wired; skip gracefully if not yet available)_

## Process

### Step 1: Resolve Context

Identify the active workspace and project from the current session/route context:

- If `workspaceId` / `projectId` are available from context, use them.
- Otherwise call `mcp__Engy__listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `mcp__Engy__getProjectDetails({ projectId })` to get the project name, workspace slug, filesystem paths (`paths.systemDir`, `paths.workspaceDir`), and `workspace.repos[]`.

`systemDir` = `{workspaceDir}/system/`

### Step 2: Read Project Context

Run these in parallel:

**Completed tasks:**

```
mcp__Engy__listTasks({ projectId, status: 'done', compact: false })
```

Also fetch any tasks with status `'review'` or `'active'` to include in-progress context.

**Promoted permanent memories:**

```
mcp__Engy__listMemories({ workspaceId, compact: false })
```

Filter the results client-side to entries where `promoted === true` (permanent memories). These are the distilled insights ready to be surfaced as system docs.

**Existing system docs:**

List the contents of `systemDir` using the Read tool. Read any existing files relevant to the project's domain. If `mcp__Engy__search` is available:

```
mcp__Engy__search({ workspaceId, query: '<project summary or focus area>', collection: 'system', limit: 10 })
```

Use search results to scope which existing docs to read in full.

### Step 3: Dispatch Research Subagent

Invoke the `engy:research` subagent to gather prior decisions and supporting notes for the project's domain:

```
Task({
  subagent_type: 'engy:research',
  prompt: 'Find prior decisions, patterns, and conventions relevant to: <project name + one-sentence summary of completed work> — context: workspace=<slug>, repos=<workspace.repos[]>, milestone=<latestMilestoneRef>'
})
```

The subagent returns a `## Findings` digest with cited sources. Hold this digest for Step 4.

If the project has distinct domains (e.g., data model changes + UI changes), run a separate Task call per domain and merge the digests.

### Step 4: Analyze Gaps

Based on completed tasks + promoted memories + research digest, identify what is missing or outdated in `{workspaceDir}/system/`:

- **New feature doc needed** — a completed feature has no corresponding `system/features/<name>.md`
- **Existing feature doc outdated** — behavior changed, new edge cases emerged, or a promoted memory contradicts or extends the current doc
- **Architectural decision worth capturing** — a significant design choice made during the project (from tasks or memories) belongs in `system/technical/<topic>.md`
- **Cross-references to add** — `scenarioIds`, `linkedMemories`, or `sources` frontmatter missing from existing docs

Discard trivial changes (typos, minor wording) — only propose docs that carry actionable signal for future work.

### Step 5: Propose Changes

Write proposed updates directly to `{workspaceDir}/system/` using the Write or Edit tool. **Do not write to any other directory.**

**For new files** — create with this frontmatter and structure:

```markdown
---
description: <one-line summary of what this doc covers>
sources:
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

**For edits to existing files** — read the file first, apply the minimum change needed, write back. Add or update:
- `sources[]` frontmatter with memory paths that support the change
- A `## Sources` section (or update the existing one) with research digest citations

**If the Write tool is unavailable** and the MCP server does not expose a `dir.write` tool, print the proposed file content as a fenced markdown block with the target path in the header, so the user can apply it manually or via the editor.

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

**Next step (optional):** commit the proposed changes after review, then run `/engy:reindex` if the search index needs updating.
