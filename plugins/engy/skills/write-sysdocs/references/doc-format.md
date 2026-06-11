# Doc Format Reference

Shared conventions for every file written under `{workspaceDir}/system/` — applies to both `engy:write-sysdocs` (prose overview and technical docs) and `engy:feature-docs` (feature docs). When both skills produce docs in the same workspace, they must be indistinguishable in shape.

## Frontmatter

```markdown
---
description: <one-line summary of what this doc covers>
order: <integer>          # reading position within this directory (lower = earlier)
memoryRefs:               # optional — omit entirely if no supporting memories
  - memory/<path-to-supporting-memory>.md
---
```

- `description:` — used as the link text in the parent README's auto-generated index; make it scan-friendly.
- `order:` — assign deliberately. Foundational docs before advanced ones within each directory. Read sibling `order:` values first and slot the new doc accordingly. Preserve existing `order:` values when editing unless reordering is the explicit intent.
- `memoryRefs:` — omit the key entirely when there are no supporting memories. Do **not** use `sources:` for memory paths — that key is reserved for ingestion-snapshot paths in the memory schema.
- `scenarioIds:` — **anchoring mechanism for files that reference requirements, not for the feature doc that defines them.** Include in memory notes, technical docs, or any file that anchors its claims against specific FRs. Do **not** include in feature docs (`system/features/<area>.md`): the `## Requirements` body table is the canonical and only copy of an area's FR ids — duplicating them into frontmatter creates drift and false search hits. Omit for prose/technical docs that carry no FR anchors.

## Body Structure

```markdown
# <Feature or Topic Name>

<Body content — overview, behavior, edge cases, constraints, examples>

## Sources

<!-- engy:research synthesized <YYYY-MM-DD> -->
<Inline citations from the research digest — title + citation path for each relevant finding>
<!-- /engy:research -->
```

**Zero-findings handler:** when the `engy:research` digest signals no results (body line `No relevant prior knowledge found for this question.` or footer `Distinct findings: 0 (after dedup)`), do NOT emit the `<!-- engy:research -->` marker block. Write instead:

```markdown
## Sources

No prior knowledge found.
```

And omit the `memoryRefs:` frontmatter key entirely.

**Cite only verified symbols.** Every file path, table/column name, tool name, or API symbol in a doc must be confirmed via Glob/Grep/Read in the current run — do not copy claims from `CLAUDE.md` or other docs without checking, as those can be stale.

## README Template

Each directory under `system/` must have a `README.md`. If one does not exist when a doc is created or edited in that directory, create it:

```markdown
---
description: <one-line summary of what this directory holds>
---

<1–3 sentence prose intro + suggested reading order>

<!-- INDEX START -->
<!-- INDEX END -->
```

- `description:` — used as the directory's blurb in the parent README's index.
- The `<!-- INDEX START --> ... <!-- INDEX END -->` markers are populated by `reindex({ workspaceId, collection: 'system' })` — never hand-write links between them.
- If `init.ts` has pre-seeded a README, overwrite it in place (refresh `description:` and prose, preserve the markers).

## Directory Conventions

| Path | Content |
|---|---|
| `system/overview.md` | High-level workspace overview: purpose, stack, structure, architecture narrative |
| `system/features/<area>.md` | Feature area doc (owned by `engy:feature-docs`) — prose body + `## Requirements` EARS table |
| `system/technical/<topic>.md` | Architectural concern: what it is, how the codebase handles it, key patterns and constraints |

Assign `order:` values: foundational concerns (data storage, core protocol) before cross-cutting concerns (caching, observability) within `technical/`; conceptual dependencies first (authentication before anything that builds on it) within `features/`.

## Reindex Step

After writing any docs or READMEs, call:

```
reindex({ workspaceId, collection: 'system' })
```

This is mandatory — it populates the README index blocks and refreshes the vector search index for the `system` collection. Run once per skill invocation, after all writes for that invocation are complete.
