# EARS-BDD Reference

Conventions, id scheme, tagging contract, and format rules for EARS-driven requirements traceability. Consult this file from any skill or agent that authors FRs or tags tests. This is not a standalone workflow — it is a reference that layers onto the existing steps of the planning funnel (`engy:write-spec` → `engy:milestone-plan` → `engy:plan`) and `engy:implement`.

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
- **Never renumber, never reuse** — once used, a number is spent: a retired FR is deleted outright (no tombstone — see "Changing FRs over time"), and its number is not reused for new behaviour. Allocate a new id for any replacement. Renumbering breaks the trace graph.
- To pick the next free number, read the area's current max from the docs (see the allocation rule under "Augmentations to planning skills") — `trace` reports coverage, not a next-id.

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

After editing `system/features/*.md` (during implementation or feature-doc maintenance — **not** during planning, which only edits plan docs), run `engy:reindex` so structured search (`search({ filters: { frs: […] } })`) reflects the new FRs. `trace` reads the filesystem live and needs no reindex.

## Augmentations to planning skills (`engy:write-spec`, `engy:milestone-plan`, `engy:plan`)

These additions apply only when EARS-BDD is enabled for the workspace (see each planning skill's EARS-BDD gate note). They make the planning funnel **pre-plan the durable FR contracts** so implementation has a fixed target instead of minting ids mid-build. The FR ids flow down one funnel — spec → milestone → task → implementation — in a single `FR-<AREA>-<NNN>` namespace.

Resolve workspace paths first: call `getProjectDetails(projectId)` (or `getWorkspaceDetails`) and read the workspace dir and `workspace.id`. `systemDir` is `{workspaceDir}/system`; feature docs live in `systemDir/features/`.

### Allocate durable ids, not local numbering

When EARS-BDD is off, each layer numbers requirements locally (`FR-N.M` in the SRS, `FR-TG1.1` in milestone plans). When **on**, replace those schemes with durable `FR-<AREA>-<NNN>` ids:

1. **Assign an area.** Glob `systemDir/features/*.md` and read the area tokens from the filenames (`search.md` → `SEARCH`). Reuse an exact match when the behaviour fits, or an area already introduced upstream in this spec/plan; otherwise name a new SCREAMING-KEBAB area. The token becomes the feature-doc filename stem (`USER-AUTH` → `system/features/user-auth.md`), so pick it deliberately and check the filesystem first to avoid splitting one concept across two areas. When the new behaviour is a sub-feature of an existing area's scope (e.g. keyboard nav within an existing `task-board.md`), extend that area; create a new area only when the behaviour is genuinely orthogonal.
2. **Find the area's high-water mark by reading docs — not `trace`.** `trace` reports coverage; it does **not** return a per-area max or the id list, and there is no allocate-id tool. Allocation is a static read: scan the area's `system/features/<area>.md` `## Requirements` table **and** any in-flight spec / milestone-plan / task-plan docs for `FR-<AREA>-` ids, and take the highest number seen as the floor. (Locate the in-flight plan docs via `getProjectDetails` `specDir` / `listTasks` `specPath`, then grep them for `FR-<AREA>-`.) Planning ids live only in plan docs until implementation, so `system/features` alone is not yet authoritative — the doc scan is what stops two plans re-allocating the same id. If the area has no FR anywhere (new or greenfield workspace), start at `FR-<AREA>-010`.
3. **Allocate the next free id with a gap** above that floor (per the id scheme above — e.g. max `FR-SEARCH-011` → `FR-SEARCH-015`).
4. **Write each requirement as one EARS SHALL statement** carrying its durable id — one FR per independently testable, user-observable behaviour. Do not split a single observable behaviour into several ids just because its implementation has multiple internal parts.

### Funnel discipline

Ids are allocated as early as the layer that first introduces the behaviour and are **reused verbatim downstream** — never renumbered:

- **`engy:write-spec`** — the SRS is the first allocation point. Milestone FR lists in the spec carry `FR-<AREA>-<NNN>` EARS rows (replacing `FR-N.M`).
- **`engy:milestone-plan`** — each TG's `### Requirements` lists the durable ids it delivers, drawn from the SRS. Allocate a new id only for milestone-level detail the SRS did not capture.
- **`engy:plan`** — the `## Functional Requirements` section lists the durable `FR-<AREA>-<NNN>` rows for the task scope, reusing the spec/milestone ids and adding finer-grained ones only where the task introduces new behaviour.

At every layer the FR is written as a `| FR-<AREA>-<NNN> | <EARS SHALL text> |` table row — not the off-mode numbered "The system shall…" list with source tags.

### Where the FRs live during planning

Planning fixes the **id + EARS text only**; it does **not** create `system/features/*.md` rows. The behaviour does not exist yet — premature doc rows would describe unbuilt behaviour and carry thin prose. The durable FRs live in the spec/plan documents until `engy:implement` materialises them into `system/features/<area>.md` (via `engy:feature-author`) once the code exists, then tags tests — see the implement augmentations below.

Enabling EARS-BDD mid-project is safe: pre-existing local `FR-TG<N>.<M>` ids in old plans are a different format and never collide with durable `FR-<AREA>-<NNN>` ids. To give already-shipped behaviour a place in the trace graph, run `engy:feature-docs` to back-fill its feature docs; otherwise just start allocating durable ids from the next plan onward.

### Human gate

Pre-planned FRs are durable contracts. They ride the normal approval gate at each layer — the user approving the spec/plan **is** the approval of its FR set. Call out any **net-new** FR id (one that does not already appear in the parent SRS or an already-approved upstream plan) explicitly in the summary so the user reviews it before approving.

## Augmentations to `engy:implement` steps

These additions apply only when EARS-BDD is enabled for the workspace (see `implement/SKILL.md` Step 1). They do not replace the existing TDD flow — they layer onto it.

### Before Step 4 — establish target FR ids

**If the plan or spec already pre-planned durable FR ids** (EARS-BDD planning, above): those ids + their EARS text **are** the target set. Locate them by grepping the task plan's `## Functional Requirements` table (or a milestone plan's `### Requirements`, or the spec's milestone FR rows) for `FR-<AREA>-<NNN>` rows. Pass them to `engy:feature-author` as the FR ids to author verbatim — it grounds and writes those exact rows, never re-allocating. They were reviewed at plan/spec approval, so no second human gate is needed unless the implementer adds an FR the plan did not list.

**Otherwise** (ad-hoc task, no pre-planned FRs), dispatch the `engy:feature-author` subagent with the ask, `systemDir`, and `repos[]`:

```
Task({
  subagent_type: 'engy:feature-author',
  prompt: 'Ask: <task title + description, or plan summary>\nsystemDir: <paths.systemDir>\nrepos: <repos[]>\nTarget FR ids (pre-planned, author verbatim): <ids + EARS text, or "none — allocate as needed">'
})
```

The subagent returns the **target FR ids** (existing matched + any newly authored). New FRs are written **uncommitted**.

**Human gate:** if the subagent authored any NEW FRs not already approved in a plan or spec, surface them to the user and let them review (diff viewer) and confirm before proceeding. Newly authored FRs are durable contracts — do not mint them silently. If only existing or pre-planned FRs were matched, continue without stopping.

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

## Changing FRs over time (FR lifecycle)

FRs are durable contracts, but specs evolve. The scanner reads the **first `## Requirements` table** of each `system/features/<area>.md` and keys everything on the FR id — so safe changes work *with* that, as follows:

- **Reorder — free.** The id is the identity, not the row position. `trace` and test tags key on the id, so rows may be reordered (e.g. to group related FRs) with no effect on the graph.
- **Edit text in place — when the contract is unchanged.** Tightening wording, fixing the EARS pattern, or clarifying a condition keeps the **same id**; tagged tests keep proving it. This is the common case and needs no new id.
- **Renumber — never.** An id is a permanent handle referenced by test-title tags, plan docs, commit messages, and the trace graph. Renumbering silently orphans every tag (they become `orphanTags`). Allocate-with-gaps exists precisely so you never need to renumber to "make room".
- **Behaviour changes or splits — allocate a new id.** When the required behaviour materially changes, or one FR splits into two, mint a **new** id (next-free-with-gap, per the allocation rule) for the new contract and write/retag its tests. Never repurpose an old id for new behaviour — an old `[FR-AREA-NNN]` tag in history must always mean the same thing.
- **Retire — delete the row, and delete its test tags.** Git history is the audit trail; no tombstone rows. The live graph stays self-consistent because it only ever sees the current docs and tests. Do not *reuse* a deleted number for unrelated behaviour — allocate the next free id with a gap as usual (an old `[FR-AREA-NNN]` reference must never come to mean something new). Reuse only confuses historical cross-references, not the live system, so this is a discipline rule, not a hard invariant.

After any `system/features/*.md` edit, run `engy:reindex` (see the `trace` quick reference above).

## Anti-patterns

- Duplicating FR ids into frontmatter — the body table is the only authored copy.
- Maintaining a `files:` list on an FR — let the FR→test→source graph stay load-bearing.
- Renumbering an FR id, or reusing a deleted id's number for unrelated behaviour — allocate a new one with a gap instead.
- Tagging every micro unit test — tag the behavioural slices that prove the FR.
- Writing the implementation before the failing test — the Red step is the spec check.
- Authoring FRs mid-implementation outside the `engy:feature-author` step.
