---
name: engy:bootstrap-sysdocs
description: This skill should be used when the user asks to "bootstrap system docs", "generate system documentation", "initialize workspace docs", or "create initial system docs" for a workspace.
---

# System Docs Bootstrap

Terminal skill that produces the initial set of system documentation files for a workspace by analyzing the codebase on disk and folding in any prior knowledge from the workspace knowledge graph. Files are written uncommitted under `{workspaceDir}/system/` for the user to review in the diff viewer's "Latest Changes" mode and approve (commit) or reject (revert).

## MCP Tools

- `listWorkspaces` — discover workspaceId when not in context
- `getWorkspaceDetails` — resolve workspace paths (`paths.workspaceDir`, `paths.systemDir`) and `repos[]`
- `search` — locate any existing system docs to avoid clobbering (skip gracefully if the workspace has no system collection yet)

All codebase exploration uses the built-in **Glob**, **Grep**, and **Read** tools directly against the absolute repo paths in the top-level `repos[]` array returned by `getWorkspaceDetails`. All file writes use the built-in **Write** tool against absolute paths under `{workspaceDir}/system/`.

## Process

### Step 1: Resolve Workspace

Identify the active workspace from session/route context:

- If `workspaceId` is available from context, use it.
- Otherwise call `listWorkspaces`. If multiple workspaces exist, ask the user which to target.
- Call `getWorkspaceDetails({ workspaceId })` to obtain `paths.workspaceDir`, `paths.systemDir`, and `repos[]` (absolute paths on disk).

`systemDir` = `{workspaceDir}/system/`

### Step 2: Check Existing System Docs

Use **Glob** against `{systemDir}/**/*.md` to enumerate any existing docs, then run:

```
search({ workspaceId, query: 'overview architecture', collection: 'system', limit: 10 })
```

If `search` returns an error (e.g. the index has never been built or embeddings are not yet available), treat it as "no existing docs found" and proceed — the Glob enumeration is the authoritative list.

**Write in place.** Every write is uncommitted: it lands as a working-tree change the user reviews in the diff viewer's "Latest Changes" mode and keeps (commit) or discards (revert). Git is the safety net, so overwrite freely and never create `.draft` files — the user can see exactly what changed in the diff.

- If a planned output path does **not** exist, create it (`NEW` in the Step 7 summary).
- If it **already exists** — including the server-seeded placeholder `overview.md` that `init.ts` writes on workspace creation — overwrite it in place (`UPDATED`).

No confirmation prompt is required.

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
  prompt: 'Existing architectural decisions, patterns, and conventions for this workspace — context: workspaceId=<workspaceId>, workspace=<slug>, repos=<repos[]>'
})
```

The `engy:research` agent **requires the numeric `workspaceId`** in the prompt (it errors with `Error: workspaceId missing from prompt` if absent) — pass the integer from Step 1, not the slug.

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
order: <integer>          # reading position within this directory (lower = earlier)
memoryRefs:               # optional — omit entirely if no supporting memories
  - memory/<path-to-supporting-memory>.md
---

# <Feature or Topic Name>

<Body content — overview, behavior, edge cases, constraints, examples>

## Sources

<!-- engy:research synthesized <YYYY-MM-DD> -->
<Inline citations from the research digest — title + citation path for each relevant finding>
<!-- /engy:research -->
```

**Assign `order:` values deliberately** — foundational docs should come before advanced ones within each directory. Suggested ordering: `system/overview.md` is standalone (no `order:` needed there as it is the entry point). Within `features/`, order by conceptual dependency (e.g., authentication before anything that builds on it). Within `technical/`, order foundational concerns (data storage, core protocol) before cross-cutting concerns (caching, observability).

Use `memoryRefs:` (not `sources:`) for the supporting-memory paths — `sources` is a reserved memory-frontmatter key meaning ingestion-snapshot paths, and reusing it here would pollute `search({ filters: { sources } })`.

**Zero-findings handler:** the `engy:research` agent signals no results with the body line `No relevant prior knowledge found for this question.` and the footer `Distinct findings: 0 (after dedup)`. When you see either, do NOT emit the `<!-- engy:research -->` marker block — instead write a single inline line under `## Sources`: `No prior knowledge found.` and omit the `memoryRefs:` frontmatter key entirely.

**Cite only verified symbols:** every file path, table/column name, tool name, or API symbol you put in a doc must be one you confirmed exists via Glob/Grep/Read in this run — do not copy claims from `CLAUDE.md` or other docs without checking, as those can be stale.

### Step 6: Write Files

Use the **Write** tool to write each generated doc to its absolute path under `{systemDir}`, overwriting in place per Step 2.

After writing all docs, ensure each system directory has a `README.md` with a prose intro and empty index markers. Create or refresh these three files:

- **`system/README.md`** — 1–3 sentences describing what the `system/` collection holds and that `overview.md` is the starting narrative, followed by the empty marker pair.
- **`system/features/README.md`** — 1–3 sentences describing the feature docs and that they are ordered for top-to-bottom reading.
- **`system/technical/README.md`** — 1–3 sentences describing the architectural concern docs and their reading order.

Each README has a `description:` frontmatter (used as the directory's blurb in the parent README's index), a prose intro, and the empty marker pair — nothing between the markers, as the link list is populated by the reindex step:

```markdown
---
description: <one-line summary of what this directory holds>
---

<1–3 sentence prose intro + suggested reading order>

<!-- INDEX START -->
<!-- INDEX END -->
```

If `init.ts` has pre-seeded a README, overwrite it in place (refresh the `description:` and prose, preserve the markers).

Files are written **uncommitted** — they appear as working-tree changes visible in the diff viewer's "Latest Changes" view. The user reviews and commits them when satisfied.

### Step 6b: Reindex

After all doc files and READMEs are written, call:

```
reindex({ workspaceId, collection: 'system' })
```

This populates the `<!-- INDEX START --> ... <!-- INDEX END -->` blocks in each README with an ordered link list (sorted by `order:`, using each doc's `description:` as the link text) and refreshes the search index for the `system` collection.

### Step 7: Print Summary

After writing all files, print:

```
System docs bootstrap complete.

Files written:
  NEW      system/overview.md                — workspace overview, stack, structure
  NEW      system/features/auth.md           — OAuth2 + session handling  (order: 1)
  UPDATED  system/technical/ws-protocol.md   — WebSocket REGISTER handshake  (order: 1)
  ...

READMEs generated/updated:
  system/README.md
  system/features/README.md
  system/technical/README.md

Research digest: <N> findings from <N> sources walked.   (or: No prior knowledge found.)

Review changes in the diff viewer (Latest Changes mode), then commit or revert.
Next step: refine individual docs with /engy:sysdoc-assistant.
```

Each line includes: disposition (`NEW` for a freshly created file, `UPDATED` for an in-place overwrite of an existing file), relative path, and a one-line rationale.

## Key Principles

- **Scope only `system/`** — never write to `docs/`, `memory/`, `projects/`, or anywhere outside `{workspaceDir}/system/`.
- **Write in place** — overwrite existing docs directly; never create `.draft` files. Writes are uncommitted, so the diff viewer's "Latest Changes" view and commit/revert are the review and safety net.
- **No automatic commit** — writes land as working-tree changes for the user to review.
- **Breadth first** — prefer a working overview of all major areas over deep coverage of one area.
- **Cite sources** — when research findings inform a doc, cite them inline under `## Sources`. When there are none, say so explicitly.
- **Use built-in file tools** — codebase exploration is Glob/Grep/Read against the absolute paths in the `repos[]` array from `getWorkspaceDetails`; writes are the Write tool against absolute paths under `systemDir`.
- **LLM analysis is in-context** — codebase mapping and gap analysis run in the main agent; the only external dispatch is the `engy:research` subagent.

## Flow Position

**Typical trigger:** starting a new workspace or when `{workspaceDir}/system/` is empty or sparse.

**Follow-up:** `/engy:sysdoc-assistant` for ongoing editing; `/engy:propose-sysdocs` after project completion to fold in new learnings.
