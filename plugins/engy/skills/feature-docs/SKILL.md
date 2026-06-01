---
name: engy:feature-docs
description: This skill should be used when the user asks to "bootstrap feature docs", "write feature requirements", "establish the EARS baseline", "author FRs for the codebase", "create feature area docs", or "author requirements for a feature area". Sole owner of system/features/<area>.md — authors the complete feature doc (prose body + EARS requirements) for each area with a human confirmation gate at every step.
---

# Feature Docs

Owns `system/features/<area>.md` as ONE artifact per area: prose body + `## Requirements` EARS table + `## Sources` + frontmatter. Establishes the EARS functional-requirement (FR) baseline for an existing codebase by reverse-engineering FRs from implemented, tested behaviour. Where a feature doc is missing entirely, it is created (prose intro + requirements); where it exists without a `## Requirements` section, the section is added.

Consult [`../write-sysdocs/references/doc-format.md`](../write-sysdocs/references/doc-format.md) for frontmatter, `## Sources`, README template, and reindex conventions — feature docs must be shaped identically to prose docs. Consult `plugins/engy/skills/implement/references/ears-bdd.md` for EARS patterns, id scheme, format contract, and the FR lifecycle rules (editing, reordering, retiring FRs over time). Authoring is delegated to `engy:feature-author`; this skill orchestrates the area list, the task loop, and the human gates.

## The Pipeline: code/tests → BDD → EARS

This skill runs the **inverse** of the EARS-BDD implement flow. A brownfield codebase already has code and (usually) tests, so bootstrap runs backward:

```
existing code + tests  →  observed behaviours (BDD)  →  EARS FRs  →  tag the tests that prove them
```

Code and existing tests are the **source of truth** — FRs are reverse-engineered from behaviour that is actually implemented and tested, never aspirational. Per area, observed behaviours are captured in a throwaway **working doc** (scratchpad) that carries the inventory from one subagent to the next; the durable output is the complete feature doc in `system/features/` plus FR-id tags added to the existing tests.

Two mandatory properties:

- **Human in the loop at every gate.** The human confirms the list of areas before any authoring, and confirms each area's complete doc after it is populated and validated.
- **One area at a time, tracked as internal tasks.** After the area list is confirmed, an internal session task is created per area; areas are worked sequentially.

Writes are **uncommitted** — every authored doc and FR-id tag lands as a working-tree change for the human to review in the diff viewer and keep (commit) or discard (revert). Never commit.

## Area Selection Parameter

The skill accepts an optional area selection argument:

- `all` (default) — discover and process every feature area.
- `project-touched` — limit to areas touched by the current project's completed tasks.
- `<area-name>` — process one named area only.

## MCP Tools

- `getWorkspaceDetails` — resolve `paths.workspaceDir`, `paths.systemDir`, and `repos[]`
- `trace` — `trace({ workspaceId })` for current FR/coverage state; `trace({ workspaceId, file })` to inspect a single area doc
- `reindex` — refresh the `system` collection after authoring

Internal progress is tracked with session task tools (`TaskCreate`, `TaskUpdate`) — the same mechanism `engy:implement` uses.

## Process

### Step 1: Resolve Workspace

Obtain `workspaceId` from context or via `listWorkspaces`. Call `getWorkspaceDetails({ workspaceId })` for `paths.systemDir` and `repos[]`. Feature docs live in `systemDir/features/`.

Pick a throwaway **scratch dir** — use `${TMPDIR:-/tmp}/engy-feature-docs-<workspaceSlug>/`. Working docs are never written under `systemDir` or `repos[]` and are never committed; delete them once an area is approved.

### Step 2: Discover Feature Areas

Build the candidate list according to the area selection parameter:

1. **Existing docs.** Glob `systemDir/features/*.md`. For each, classify as: *has complete doc* / *has doc, missing `## Requirements`* / *missing doc*.
2. **Codebase clusters** (for `all` or `project-touched`). Glob/Grep across `repos[]` for feature boundaries (routers, services, controllers, major modules — e.g. `router\.|app\.use|@Controller|export.*Service`). Read a few high-signal entry points to confirm. Map clusters to area names (kebab-case, matching existing feature-doc naming).
3. **Merge** into one list: each area marked `new doc` / `add requirements` / `extend existing`. Aim for breadth — a coherent set of feature areas, not exhaustive sub-features.

### Step 3: Confirm the List (human gate #1)

Present the full proposed area list and stop for confirmation:

```
Proposed feature areas (<N>):
  1. search          extend existing  (11 FRs today)
  2. memory          add requirements (doc exists, no ## Requirements)
  3. websocket       new doc
  ...
Confirm this list, or edit it (add / remove / rename / merge areas) before I create tasks.
```

Do not proceed until the human confirms. Apply any edits they request.

### Step 4: Create One Internal Task per Confirmed Area

Call `TaskCreate` for **one session task per area** that needs work (e.g. `"Feature doc: <area>"`). Chain them with `TaskUpdate` (`addBlockedBy`) so they execute strictly in order. Add a final task `"Reindex + summarize feature docs"` blocked by all area tasks.

### Step 5: Work Each Area (inventory → author → tag → validate → human gate)

For each area task in order:

1. **Mark `in_progress`** (`TaskUpdate`).

2. **Inventory behaviours — code/tests → BDD (subagent + working doc).** Dispatch a subagent to read the area's source and existing tests and write a throwaway working doc:

   ```
   Task({
     subagent_type: 'general-purpose',
     prompt: 'Read the "<area>" feature area\'s source and existing tests under <repos[]>. Write a working doc to <scratchDir>/<area>.md inventorying its behaviour in BDD terms: one row per distinct behaviour — trigger/state → expected response — and the existing test (file:line) that verifies it, or "(none)" if untested. Cover only behaviour actually implemented/tested; cite real symbols. Read-only on the codebase; write ONLY the working doc.'
   })
   ```

3. **Author complete feature doc — BDD → FRs + prose (subagent).** Dispatch `engy:feature-author`, pointing it at the working doc:

   ```
   Task({
     subagent_type: 'engy:feature-author',
     prompt: 'Author the complete feature doc for the "<area>" area. Behaviour inventory (BDD): <scratchDir>/<area>.md\nsystemDir: <paths.systemDir>\nrepos: <repos[]>'
   })
   ```

   The agent writes the complete area doc — prose body + `## Requirements` EARS table + `## Sources` + frontmatter per the doc-format conventions — to `systemDir/features/<area>.md` (uncommitted) and returns the authored FR ids + grounding.

4. **Tag existing tests (subagent).** Back-tag the area's existing tests with FR ids:

   ```
   Task({
     subagent_type: 'general-purpose',
     prompt: 'For the "<area>" feature area, FRs: <authored FR ids + text>. The working doc <scratchDir>/<area>.md maps each behaviour to the existing test that verifies it — use it as the starting map. For each FR, add the FR id to the title string of the existing test(s) that verify it, e.g. it(\'[FR-AREA-NNN] …existing title…\'). Tag at describe level when a whole block proves one FR. Add NO new tests and change NO assertions — only prepend tags to titles of tests that genuinely verify the FR. Report: FR → test(s) tagged, and any FR with NO existing test (a real coverage gap). Honour the @rtm-ignore convention. Writes are uncommitted.'
   })
   ```

   FRs left without a matching existing test are **coverage gaps** — record them; they are closed later via `engy:implement` (EARS-BDD mode), not by inventing tests here.

5. **Validate (subagent).** Dispatch an independent validation subagent (model `sonnet`):

   ```
   Task({
     subagent_type: 'general-purpose',
     prompt: 'Read system/features/<area>.md and the source + tests it concerns under <repos[]>. For each FR: (1) valid EARS pattern + SHALL present; (2) atomic and independently testable; (3) accurate vs the actual code behaviour (no invented/overreaching claims); (4) id matches FR-<AREA>-<NNN>, unique, not a renumber; (5) each [FR-…] tag is on a test that genuinely verifies that FR (flag mis-tags). Report per-FR verdicts, malformed/duplicate/inaccurate rows, mis-tags, and uncovered FRs. Read-only — do not edit.'
   })
   ```

   Also run: `trace({ workspaceId, file: 'system/features/<area>.md' })` and confirm no `malformed`/`duplicateIds`/`orphanTags`.

6. **Human gate #2.** Present the complete doc, FR table, test tags, coverage gaps, and validator verdicts. Ask the human to **approve**, **edit** (apply corrections, then re-validate), or **redo** (re-dispatch with guidance). Do not advance until approved.

7. **Mark the task `completed`**, delete the area's working doc from the scratch dir, and move to the next area task.

### Step 6: Reindex

After the last area is approved:

```
reindex({ workspaceId, collection: 'system' })
```

### Step 7: Summary

```
Feature docs complete.

Areas authored:
  search       +4 FRs   (FR-SEARCH-012 … 015)   3 tests tagged, 1 gap   approved
  memory       +6 FRs   (new ## Requirements)    6 tests tagged, 0 gaps  approved
  websocket    +5 FRs   (NEW doc)                2 tests tagged, 3 gaps  approved
  ...

Total: <N> FRs across <M> areas — all uncommitted (docs + test-title tags).
Coverage: <K> FRs now have tagged tests; <U> uncovered gaps (close with engy:implement in EARS-BDD mode).

Review the working-tree changes in the diff viewer, then commit or revert.
```

## Key Principles

- **Code/tests are the source of truth** — FRs are reverse-engineered from implemented, tested behaviour, never aspirational.
- **One artifact per area** — the complete feature doc (prose + EARS + sources) is the durable output. Working docs are throwaway.
- **Tag, don't invent** — back-tag existing tests; FRs with no existing test are gaps, closed later via `engy:implement` (EARS-BDD mode).
- **Human gates are mandatory** — one before task creation (area list), one per area after author+tag+validate. Never auto-advance.
- **Author and validator are separate subagents** — the author writes; an independent validator checks. Do not let the author self-certify.
- **Uncommitted, always** — git + the diff viewer are the review surface and safety net.

## Flow Position

**Typical trigger:** establishing the EARS FR baseline for a codebase adopting the EARS-BDD flow; or when `engy:write-sysdocs` hands off a feature area during init or refresh.

**Depends on:** `engy:feature-author` (author), `plugins/engy/skills/implement/references/ears-bdd.md` (conventions), `trace` / `engy:validate` (validation), `../write-sysdocs/references/doc-format.md` (doc shape).

**Follow-up:** enable EARS-BDD mode on the workspace; use `engy:implement` (EARS-BDD mode) to add tagged tests and close uncovered FRs.
