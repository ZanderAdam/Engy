---
name: validate
description: This skill should be used when the user asks to "validate workspace", "check knowledge integrity", "run validation", "check for broken links", or "verify memories before promoting".
---

# Validate Workspace

Runs a comprehensive set of integrity checks on the workspace knowledge files and reports findings grouped by severity.

## When to Use

- Before promoting fleeting memories to permanent
- After a bulk import or reorganization
- Periodically as part of knowledge hygiene
- When search is returning unexpected results

## Process

### Step 1: Identify Workspace

Use `listWorkspaces` to find the target workspace. If the user specified one, match by name or slug.

### Step 2: Run Validation

Call the `validateWorkspace` MCP tool:

```
validateWorkspace({ workspaceId: <id> })
```

This runs all checks server-side:

- **Broken links** — every `linkedMemories` entry and `sources[]` reference must exist on disk. **Note:** broken-link checking covers DB-tracked `linkedMemories` and `sources` frontmatter only. Inline markdown links in document bodies are not checked.
- **Schema compliance** — memory files in `memory/{subtype}/` must have `title` and `subtype` frontmatter
- **Duplicate IDs** — same `filePath` cannot appear twice in `permanentMemories`
- **Orphaned content** — DB rows with no matching file on disk
- **Lifecycle consistency** — promoted fleeting memories must have a valid `promotedFromId`
- **Stale memory** — permanent memories whose `supersededById` points to a record that itself has been superseded (multi-hop stale chain)
- **Missing sources** — permanent memories whose `sources[]` array references paths that do not exist under `memory/sources/` or `memory/references/`
- **Commit-message conformance** — commits touching `memory/` should follow `memory(<op>):` convention
- **Index status** — files with `needsEmbedding > 0` are reported as awaiting embedding

### Step 3: Present Findings

Format the report by severity:

```
Workspace Validation: <workspace-name>

ERRORS (must fix)
  [broken-links] memory/facts/001.md → linkedMemory "memory/patterns/missing.md" not found
  [orphaned-content] memory/decisions/old.md — in DB but not on disk

WARNINGS (should fix)
  [schema-compliance] memory/insights/202501010042-insight.md — missing field: subtype
  [lifecycle-consistency] Fleeting memory id=17 promoted but missing promotedFromId

INFO
  [index-status] 3 file(s) awaiting embedding — run /engy:reindex to generate vectors
  [commit-message-conformance] Commit "add memory file" touches memory/ but skips convention

Summary: 2 errors, 2 warnings, 2 infos
```

### Step 4: Recommend Actions

For each severity group, suggest next steps:

- **Errors** — must be resolved before the knowledge graph is trustworthy. Fix links, re-index, delete orphaned DB rows, or restore missing files.
- **Warnings** — should be fixed. Add missing frontmatter fields, correct lifecycle references.
- **Info** — optional. Run `/engy:reindex` if embedding lag is reported.

If there are no findings: "Workspace is clean — no integrity issues found."

## Output Format

Findings grouped by severity (errors first), followed by a one-line summary.
Each finding includes: `[check-name] <path-if-applicable> — <message>`.

## Key Principles

- Read-only — validate never modifies state.
- Severity grouping — errors must be fixed; warnings are advisory.

## Flow Position

**Typical trigger:** user wants to verify knowledge graph integrity before promoting memories or after a bulk import.

**Next step:** address errors first, then run `/engy:reindex` if index status flagged embedding lag.
