---
name: engy:bootstrap-sysdocs
description: Generate initial system docs (overview, features, technical) for a workspace by reading the codebase. Use when starting a new workspace or when system docs are sparse.
---

# System Docs Bootstrap

Terminal skill that produces the initial set of system documentation files for a workspace by analyzing the codebase on disk and folding in any prior knowledge from the workspace knowledge graph. Files are written uncommitted under `{workspaceDir}/system/` for the user to review in the diff viewer's "Latest Changes" mode and approve (commit) or reject (revert).

## MCP Tools

- `mcp__Engy__listWorkspaces` — discover workspaceId when not in context
- `mcp__Engy__getWorkspaceDetails` — resolve workspace paths (`paths.workspaceDir`, `paths.systemDir`) and `repos[]`
- `mcp__Engy__search({ workspaceId, query, collection: 'system', limit: 10 })` — locate any existing system docs to avoid clobbering (skip gracefully if the workspace has no system collection yet)

All codebase exploration uses the built-in **Glob**, **Grep**, and **Read** tools directly against the absolute repo paths returned in `workspace.repos[]`. All file writes use the built-in **Write** tool against absolute paths under `{workspaceDir}/system/`.

## Process

### Step 1: Resolve Workspace

Identify the active workspace from session/route context:

- If `workspaceId` is available from context, use it.
- Otherwise call `mcp__Engy__listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `mcp__Engy__getWorkspaceDetails({ workspaceId })` to obtain `paths.workspaceDir`, `paths.systemDir`, and `repos[]` (absolute paths on disk).

`systemDir` = `{workspaceDir}/system/`

### Step 2: Check Existing System Docs

Use **Glob** against `{systemDir}/**/*.md` to enumerate any existing docs. If `mcp__Engy__search` is available, also run:

```
mcp__Engy__search({ workspaceId, query: 'overview architecture', collection: 'system', limit: 10 })
```

If substantial docs already exist, warn the user before continuing: "System docs already exist. This will generate drafts alongside them — review and merge manually." Proceed only after confirmation.

### Step 3: Discover Codebase Structure

For each absolute repo path in `workspace.repos[]`, use built-in tools to build a structural map:

- **Glob** for top-level directories and key entry points (e.g., `*/package.json`, `**/server.ts`, `**/main.ts`, `**/app/layout.tsx`, `**/index.ts`).
- **Read** the root `package.json` / `pyproject.toml` / `Cargo.toml` (or equivalent) to identify the technology stack.
- **Grep** for routing or feature-area markers (e.g., `router\.|app\.use|@Controller|export.*Route`) to spot major feature clusters.
- **Read** a small set of high-signal entry-point files (one or two per repo) to confirm architecture.

Focus on breadth over depth. The goal is a structural map, not line-by-line analysis.

### Step 4: Dispatch Research Subagent

Invoke the `engy:research` subagent to surface any existing workspace knowledge relevant to the codebase:

```
Task({
  subagent_type: 'engy:research',
  prompt: 'Existing architectural decisions, patterns, and conventions for this workspace — context: workspace=<slug>, repos=<workspace.repos[]>'
})
```

The subagent returns a `## Findings` digest with cited sources. Hold this digest for Step 5.

If the codebase spans distinct domains (e.g., backend + frontend + daemon), run a separate Task call per domain and merge the digests.

### Step 5: Generate System Docs

Based on the codebase map and research digest, draft the following files. Aim for **3–6 feature docs and 2–4 technical docs** — prefer fewer, higher-quality docs over exhaustive coverage.

**`system/overview.md`** — high-level workspace overview:

- What the workspace does and its primary user
- The repository / package structure
- Technology stack (languages, frameworks, key libraries)
- How the pieces connect (brief architecture narrative)

**`system/features/<name>.md`** — one per major feature cluster (e.g., `authentication.md`, `task-management.md`, `git-integration.md`):

- What the feature does
- Key components/files involved (cite paths)
- Notable design decisions

**`system/technical/<topic>.md`** — one per major architectural concern (e.g., `data-storage.md`, `websocket-protocol.md`, `api-surface.md`):

- What the concern is
- How the codebase handles it
- Key patterns and constraints

Use this frontmatter and structure for every generated file:

```markdown
---
description: <one-line summary of what this doc covers>
sources:
  - memory/<path-to-supporting-memory>.md
---

# <Feature or Topic Name>

<Body content — overview, behavior, edge cases, constraints, examples>

## Sources

<!-- engy:research synthesized <YYYY-MM-DD> -->
<Inline citations from the research digest — title + citation path for each relevant finding>
<!-- /engy:research -->
```

**Zero-findings handler:** if the `engy:research` subagent returns `Findings: 0`, do NOT emit the `<!-- engy:research -->` marker block. Instead, write a single inline line under `## Sources`: `No prior knowledge found.` Omit the `sources:` frontmatter key entirely when there are no supporting memories.

### Step 6: Write Files

Use the **Write** tool to write each generated doc to its absolute path under `{systemDir}`:

- `{systemDir}/overview.md`
- `{systemDir}/features/<name>.md`
- `{systemDir}/technical/<topic>.md`

Files are written **uncommitted** — they appear as working-tree changes visible in the diff viewer's "Latest Changes" view. The user reviews and commits them when satisfied.

### Step 7: Print Summary

After writing all files, print:

```
System docs bootstrap complete.

Files written:
  NEW     system/overview.md                — workspace overview, stack, structure
  NEW     system/features/auth.md           — OAuth2 + session handling
  NEW     system/technical/ws-protocol.md   — WebSocket REGISTER handshake
  ...

Research digest: <N> findings from <N> sources walked.   (or: No prior knowledge found.)

Review changes in the diff viewer (Latest Changes mode), then commit or revert.
Next step: refine individual docs with /engy:sysdoc-assistant.
```

Each line includes: disposition (NEW), relative path, and a one-line rationale.

## Key Principles

- **Scope only `system/`** — never write to `docs/`, `memory/`, `projects/`, or anywhere outside `{workspaceDir}/system/`.
- **No automatic commit** — writes land as working-tree changes for the user to review.
- **Breadth first** — prefer a working overview of all major areas over deep coverage of one area.
- **Cite sources** — when research findings inform a doc, cite them inline under `## Sources`. When there are none, say so explicitly.
- **Use built-in file tools** — codebase exploration is Glob/Grep/Read against the absolute paths in `workspace.repos[]`; writes are the Write tool against absolute paths under `systemDir`.
- **LLM analysis is in-context** — codebase mapping and gap analysis run in the main agent; the only external dispatch is the `engy:research` subagent.

## Flow Position

**Typical trigger:** starting a new workspace or when `{workspaceDir}/system/` is empty or sparse.

**Follow-up:** `/engy:sysdoc-assistant` for ongoing editing; `/engy:propose-sysdocs` after project completion to fold in new learnings.
