# EARS-BDD Reference

Conventions, id scheme, tagging contract, and format rules for EARS-driven requirements traceability. Consult this file from any skill or agent that authors FRs or tags tests. This is not a standalone workflow — it is a reference that layers onto `engy:implement`'s existing steps.

## Core model

- **FRs live in the `## Requirements` table of `system/features/<area>.md`** — that table is the single source of truth. Do not duplicate FR ids into frontmatter.
- **Tests carry the FR id in their title string** — `it('[FR-AREA-NNN] …', …)`. The id is a statically greppable literal: it survives refactors, shows in failing-test output, and feeds the `trace` graph.
- **Source is derived** from the colocated-test convention (`foo.test.ts ↔ foo.ts`). Never hand-maintain FR→source file lists.

## EARS patterns

Every FR is `FR-<AREA>-<NNN>` + a SHALL statement in one of five patterns:

| Pattern | Shape | Use for |
|---|---|---|
| Ubiquitous | The system SHALL … | always-on behaviour |
| Event-driven | WHEN \<trigger\>, the system SHALL … | response to an event/input |
| State-driven | WHILE \<state\>, the system SHALL … | behaviour during a mode |
| Unwanted | IF \<condition\>, THEN the system SHALL … | error / edge handling |
| Optional | WHERE \<feature present\>, the system SHALL … | configurable behaviour |

A prose `shall` fallback is allowed for structural/data requirements — keep the id, SHALL, and a clear pass/fail condition.

## FR id scheme

- Format: `FR-<AREA>-<NNN>` where `<AREA>` is SCREAMING-KEBAB and `<NNN>` is a zero-padded integer.
- **Allocate with gaps** — e.g. existing max `FR-SEARCH-011` → next is `FR-SEARCH-015`. Gaps leave room for related FRs to be inserted nearby.
- **Never renumber, never reuse** — a deleted or superseded id is retired in place; allocate a new id for the replacement. Renumbering breaks the trace graph.
- `trace({ workspaceId })` lists all existing ids; pick the next free number per area.

## Test-tagging convention

Tag at the level that owns the behaviour:

- Tag at `describe` level when the whole block proves one FR.
- Tag at `it` level when individual cases prove distinct FRs.
- The relationship is many-to-many: one test may prove multiple FRs; one FR may be proven by multiple tests.
- Prefer **vertical-slice integration tests** (trophy testing) as the tagged proofs; fill gaps with focused unit tests only where a slice can't reach.

```ts
// describe-level tag
describe('[FR-SEARCH-003] filter-anchored mode', () => {
  it('returns every filter match with qmd score attached', …);
});

// it-level tag
it('[FR-SEARCH-003] returns every filter match with qmd score attached', …);
```

Every target FR must be tagged by at least one behavioural test before the work is considered done.

## Format discipline

The `trace` scan is deterministic only if the requirements table is well-formed. `engy:validate` (and `trace`) will fail on:

- A row whose ID column starts with `FR-` but is not `FR-<AREA>-<NNN>` (e.g. lowercase, missing number).
- An FR row missing the `SHALL` keyword.
- A duplicate FR id.
- A test tag referencing an FR no doc declares (orphan tag / typo).

Table format: `| FR-<AREA>-<NNN> | <EARS text> |`

If a `.test.ts` file legitimately embeds example `[FR-…]` tags as **string fixtures** rather than real test titles (e.g. tests for the traceability scanner itself), add a `@rtm-ignore` comment anywhere in the file to exclude it from the tag scan.

## `trace` quick reference

| Call | Returns |
|---|---|
| `trace({ workspaceId, fr })` | requirement text, tagged tests, colocated source; `covered` / `found` flags |
| `trace({ workspaceId, file })` | FRs defined in that feature doc, FRs whose tests/source map to that file |
| `trace({ workspaceId })` | coverage summary: totals, `uncovered`, `orphanTags`, `duplicateIds`, `malformed` |

After editing `system/features/*.md`, run `engy:reindex` so structured search (`search({ filters: { frs: […] } })`) reflects the new FRs. `trace` reads the filesystem live and needs no reindex.

## Augmentations to `engy:implement` steps

These additions apply only when EARS-BDD is enabled for the workspace (see `implement/SKILL.md` Step 1). They do not replace the existing TDD flow — they layer onto it.

### Before Step 4 — establish target FR ids

Dispatch the `engy:feature-author` subagent with the ask, `systemDir`, and `repos[]`:

```
Task({
  subagent_type: 'engy:feature-author',
  prompt: 'Ask: <task title + description, or plan summary>\nsystemDir: <paths.systemDir>\nrepos: <repos[]>'
})
```

The subagent returns the **target FR ids** (existing matched + any newly authored). New FRs are written **uncommitted**.

**Human gate:** if the subagent authored any NEW FRs, surface them to the user and let them review (diff viewer) and confirm before proceeding. Newly authored FRs are durable contracts — do not mint them silently. If only existing FRs were matched, continue without stopping.

Hold the target FR id list for Steps 4 and 5.

### In Step 4 Red — tag each failing test

When writing each failing test in the Red step, put the FR id(s) it verifies in the title string:

```ts
it('[FR-AREA-NNN] <behaviour the FR specifies>', () => { /* … */ });
```

### In Step 5 final gate — verify coverage

Before marking the work done, run the coverage check:

1. `trace({ workspaceId, fr: '<id>' })` for each target FR, or `trace({ workspaceId })` for the workspace summary.
2. Confirm every target FR reports `covered: true` and the summary shows **no** `orphanTags`, `duplicateIds`, or `malformed` rows. (`engy:validate` runs the same check.)
3. If a target FR is uncovered, return to Step 4 and add the missing tagged test before completing.

## Anti-patterns

- Duplicating FR ids into frontmatter — the body table is the only authored copy.
- Maintaining a `files:` list on an FR — let the FR→test→source graph stay load-bearing.
- Renumbering or reusing an FR id — allocate a new one with a gap instead.
- Tagging every micro unit test — tag the behavioural slices that prove the FR.
- Writing the implementation before the failing test — the Red step is the spec check.
- Authoring FRs mid-implementation outside the `engy:feature-author` step.
