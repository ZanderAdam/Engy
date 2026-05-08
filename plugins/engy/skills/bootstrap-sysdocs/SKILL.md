---
name: engy:bootstrap-sysdocs
description: Generate initial system docs (overview, features, technical) for a workspace by reading the codebase. Use when starting a new workspace or when system docs are sparse.
---

# System Docs Bootstrap

Generates the initial set of system documentation files for a workspace by analyzing the codebase and folding in any prior knowledge from the workspace knowledge graph. Results are written as uncommitted files for user review.

## MCP Tools

- `getWorkspaceDetails(workspaceId)` — resolve workspace paths (`workspaceDir`, `repos`)
- `listWorkspaces()` — find the active workspace if not already known

## tRPC Tools (for codebase exploration)

- `dir.listFiles({ dirPath })` — list markdown files in a knowledge directory
- `dir.searchRepoFiles({ dirs, query, limit })` — search repo files by query (dispatched to client daemon)

## Step 1: Resolve Workspace

1. Identify the active workspace from session context.
2. Call `getWorkspaceDetails(workspaceId)` to get `workspaceDir` and `repos`.
3. Check if `{workspaceDir}/system/` already has content via `dir.listFiles`. If substantial docs already exist, warn the user before overwriting: "System docs already exist. This will generate drafts alongside them — review and merge manually."

## Step 2: Discover Codebase Structure

Use `dir.searchRepoFiles` (or Read/Glob directly if the repos are accessible) to explore the codebase across each repo in `workspace.repos`:

- Top-level directories and their purpose
- Key entry points (e.g., `server.ts`, `main.ts`, `index.ts`, `app/layout.tsx`)
- Major feature areas (inferred from directory names, router files, component directories)
- Architectural patterns (e.g., data access layer, API surface, frontend framework)
- Public APIs and key exports

Focus on breadth over depth. The goal is a structural map, not line-by-line analysis. Limit searches to 3–5 targeted queries to stay within context budget.

## Step 3: Research Prior Knowledge

Dispatch the `engy:research` subagent to surface any existing workspace knowledge relevant to the codebase:

```
Task({
  subagent_type: 'engy:research',
  prompt: 'Existing architectural decisions, patterns, and conventions for this workspace — context: workspace=<slug>'
})
```

Fold the returned digest into the proposed docs as supporting context (inline citations where relevant).

## Step 4: Generate System Docs

Based on the codebase map and research digest, generate the following files:

### `system/overview.md`

High-level workspace overview:
- What the workspace does and its primary user
- The repository / package structure
- Technology stack (languages, frameworks, key libraries)
- How the pieces connect (brief architecture narrative)

### `system/features/<name>.md` (one per major feature area)

One file per distinct feature cluster discovered in the codebase (e.g., `authentication.md`, `task-management.md`, `git-integration.md`):
- What the feature does
- Key components/files involved
- Notable design decisions (cite research findings where relevant)

### `system/technical/<topic>.md` (one per major architectural concern)

One file per architectural concern (e.g., `data-storage.md`, `websocket-protocol.md`, `api-surface.md`):
- What the concern is
- How the codebase handles it
- Key patterns and constraints

Aim for 3–6 feature docs and 2–4 technical docs. Prefer fewer, higher-quality docs over exhaustive coverage.

## Step 5: Write Files

Write each generated doc to `{workspaceDir}/system/` using `dir.write` (tRPC) or direct file writes:

- `{workspaceDir}/system/overview.md`
- `{workspaceDir}/system/features/<name>.md`
- `{workspaceDir}/system/technical/<topic>.md`

Files are written **uncommitted** — they appear as working-tree changes visible in the diff viewer's "Latest Changes" view. The user reviews and commits them when satisfied.

## Step 6: Present Summary

Print a summary of what was generated:
- List of files written with one-line descriptions
- Any gaps or areas with low confidence (where codebase exploration was limited)
- Suggested next step: "Review the generated docs in the diff viewer, then commit what looks right. Use `/engy:sysdoc-assistant` to refine individual docs."

## Key Principles

- **Breadth first.** Prefer a working overview of all major areas over deep coverage of one area.
- **Cite sources.** When research findings inform a doc, cite them inline (e.g., `<!-- source: memory/decisions/auth-token-rotation.md -->`).
- **Uncommitted writes only.** Never commit during bootstrap — the user reviews via the diff viewer.

## Flow Position

**Use when:** Starting a new workspace or when `{workspaceDir}/system/` is empty or sparse.
**Follow-up:** `/engy:sysdoc-assistant` for ongoing editing; `/engy:propose-sysdocs` after project completion.
