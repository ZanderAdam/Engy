---
name: reindex
description: This skill should be used when the user asks to "reindex", "rebuild the index", "force reindex", "refresh search", or "reindex workspace content".
---

# Reindex Workspace

Calls the `reindex` MCP tool and reports structured per-collection counts.

## When to Use

- After large batch changes to workspace files
- When search results feel stale or miss recently added content
- Before running `/engy:validate` to ensure the index reflects current files
- After restoring files from backup

## Process

### Step 1: Identify Workspace

Use `listWorkspaces` to find the target workspace. If the user specified one by name, match by name or slug.

### Step 2: Call reindex

Call the `reindex` MCP tool:

```
reindex({
  workspaceId: <id>,
  full: false         // incremental by default; use true if user asks for a forced rebuild
})
```

Use `full: true` when the user says "force reindex", "rebuild from scratch", or "full reindex". Before doing so, ask: "This rebuilds the whole index and can take minutes — proceed? [yes]" and wait for confirmation.

To reindex a single collection (e.g., "reindex memory only"):

```
reindex({
  workspaceId: <id>,
  collection: "memory",
  full: false
})
```

### Step 3: Report Results

Print a summary table:

```
Reindex complete (Xms)

Collection  Indexed  Updated  Unchanged  Removed  Needs Embedding
system          0        0          3        0           0
docs            2        1          5        0           2
projects        0        0         12        0           0
memory          1        0          8        0           1

Total: 3 indexed/updated, 28 unchanged, 0 removed, 3 awaiting embedding
```

If `needsEmbedding > 0`, note: "Embedding will run in the background — search relevance improves as embeddings complete."

## Output Format

Structured table followed by a one-line status:
- All zeros: "Index is up-to-date."
- Changes found: "Index updated. X file(s) newly indexed, Y updated."
- Embedding needed: "X file(s) queued for background embedding."

## Key Principles

- Idempotent — re-running on unchanged files is cheap.
- qmd owns freshness — no manual mtime/SHA tracking on the engy side.

## Flow Position

**Typical trigger:** user notices stale search results or runs a bulk file change.

**Next step:** run `/engy:validate` to confirm integrity, or `/engy:knowledge-research` to query the refreshed index.
