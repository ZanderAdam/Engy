# System-Doc Skills — Validation Report

> **Note (2026-06-10):** After this validation ran, the three skills it references
> (`bootstrap-sysdocs`, `propose-sysdocs`, `sysdoc-assistant`) were consolidated into a
> single `engy:write-sysdocs` skill (init / refresh / interactive modes) before M7 merged
> to main. The file-and-line citations below (e.g. `bootstrap-sysdocs/SKILL.md:65`,
> `propose-sysdocs/SKILL.md:68`, `sysdoc-assistant/SKILL.md:88`) no longer exist;
> the equivalent code now lives in `plugins/engy/skills/write-sysdocs/SKILL.md` and its
> `references/` subdirectory. The historical findings and fix descriptions are preserved
> below as the audit trail.

**Date:** 2026-05-29
**Branch:** worktree-knowledge-system
**Scope:** The three system-doc skills added in this worktree —
`bootstrap-sysdocs`, `propose-sysdocs`, `sysdoc-assistant` — plus the docs that
`bootstrap-sysdocs` generates and the `engy:research` subagent they all depend on.

## Status: RESOLVED (2026-05-29)

All findings below have been fixed in the three skill files, plus the inherited
milestones-as-SQLite error in `web/CLAUDE.md` and every accuracy issue in the generated
docs (`web/.dev-engy/sysdoc-validation/system/`). Specifically:

- **B1–B5** fixed — `engy:research` now receives the numeric `workspaceId`; zero-findings
  detection matches the agent's real output (`Distinct findings: 0` /
  `No relevant prior knowledge found`); `propose-sysdocs` reads `repos[]` from
  `getWorkspaceDetails`, uses task status `in_progress`, and reads `result.permanent`.
- **Design correction (supersedes H1/H2):** the `.draft.md` non-destructive mechanism was
  **removed** entirely. System docs are written **in place** — writes are uncommitted and
  reviewed in the diff viewer's "Latest Changes" mode, with commit/revert as the safety
  net, so git *is* the protection and draft files were redundant clutter. (H2 — "propose
  has no draft rule" — was therefore a **false positive**; in-place is the intended
  design.) `bootstrap` now overwrites the seeded `overview.md` stub in place.
- **M1–M5** fixed — `memoryRefs:` frontmatter key (no `sources:` collision), `repos[]`
  phrasing, search-error fallback, phantom `latestMilestoneRef` removed, `realpath`
  scope check made concrete via the Bash tool. Added a "cite only verified symbols"
  guard to prevent re-copying stale claims, and a "nothing to propose" early exit.

The verdict below reflects the **original** as-written state, retained as the audit trail.

## Verdict

**The skills do NOT fully work as written.** All three share a blocking defect in how
they call `engy:research`, and each has at least one additional contract mismatch with
the real MCP/agent implementation. The *structure* of every skill is sound — tool names
mostly exist, the `system/` scoping discipline is good, the generated-doc shape is
correct — but several steps reference fields/strings/statuses that do not match the code,
so a faithful end-to-end run degrades or errors silently rather than failing loudly.

`bootstrap-sysdocs` was executed end-to-end against a seeded workspace (repo = this
worktree) and produced 10 well-structured docs, confirming the generation path works in
practice. The defects below are real but mostly narrow and mechanical to fix.

### How this was validated

- **Live run:** the dev stack on :4100 was dead/wedged and `tsx watch` is sandbox-blocked,
  so a workspace was seeded on disk exactly as `init.ts` builds one and the
  `bootstrap-sysdocs` procedure was executed faithfully (Glob/Grep/Read discovery →
  zero-findings research handler → `Write` under `system/`). Output:
  `web/.dev-engy/sysdoc-validation/system/` (gitignored).
- **Multi-agent audit:** a workflow ran 3 skill-contract auditors + 10 per-doc accuracy
  reviewers + 2 red-team passes (37 agents, ~963k tokens). The final adversarial
  verification phase failed (agents answered in prose instead of structured output), so
  every **blocking** finding below was **re-confirmed by hand against the source** — file
  and line cited. The most serious bugs were independently surfaced by 3+ agents.

---

## Blocking findings (confirmed against source)

### B1 — All three skills call `engy:research` with the slug, not the numeric `workspaceId` → research always errors
The agent contract is explicit: `engy-research.md:43` — *"The `workspaceId` MUST be
provided in the prompt by the caller. If absent, return a single line: `Error:
workspaceId missing from prompt.`"* — and it calls `search({ workspaceId: z.number() })`
(`mcp/index.ts:1351`). But every skill passes only `workspace=<slug>`:
- `bootstrap-sysdocs/SKILL.md:65` — `context: workspace=<slug>, repos=<workspace.repos[]>`
- `propose-sysdocs/SKILL.md:68` — `context: workspace=<slug>, repos=..., milestone=...`
- `sysdoc-assistant/SKILL.md:88` — `context: workspace=<slug>, doc=..., intent=...`

**Effect:** the research subagent returns its missing-workspaceId error on every real
invocation; the skills then proceed with zero prior knowledge and no error handling.
**Fix:** include `workspaceId=<numericId>` (resolved in Step 1) in all three prompt
templates.

### B2 — Zero-findings detection string never matches the agent output (all three skills)
`bootstrap-sysdocs:116` and `propose-sysdocs:76` (and the shared contract in
`sysdoc-assistant`) trigger their zero-findings handler on the literal `Findings: 0`.
The agent never emits that string — its zero-result output is
`No relevant prior knowledge found for this question.` with footer
`Distinct findings: 0 (after dedup)` (`engy-research.md:152,156`).

**Effect:** the handler is dead code. Even with no findings the skill emits the
`<!-- engy:research synthesized -->` citation block (empty/fabricated) instead of writing
`No prior knowledge found.` — i.e. the exact branch this validation's manual run had to
apply by hand. **Fix:** match on `Distinct findings: 0` or
`No relevant prior knowledge found`. (Better: have `engy:research` emit a canonical
`Findings: 0` sentinel line so callers have a stable contract.)

### B3 — `propose-sysdocs` reads `workspace.repos[]` from `getProjectDetails`, which doesn't return it
`propose-sysdocs:27` instructs obtaining `workspace.repos[]` from
`getProjectDetails({ projectId })`. That tool returns
`workspace: { id, name, slug }` only (`mcp/index.ts:342`) — `repos` lives on the
workspace row and is exposed solely by `getWorkspaceDetails`.

**Effect:** `repos[]` is `undefined`; the research prompt embeds `repos=undefined` and all
repo-scoped exploration breaks. **Fix:** call `getWorkspaceDetails({ workspaceId })` for
`repos` (as `bootstrap-sysdocs` correctly does), or add `repos` to the
`getProjectDetails` workspace sub-object.

### B4 — `propose-sysdocs` uses an invalid task status `'active'`
`propose-sysdocs:40` says to fetch tasks with status `'review'` or `'active'`. The `tasks`
status enum is `['backlog','todo','in_progress','review','done']` (`schema.ts:123`);
`'active'` belongs to `taskGroups`/`projects`, not tasks. **Effect:** `listTasks({ status:
'active' })` fails Zod validation / returns nothing. **Fix:** use `'in_progress'`.

### B5 — `propose-sysdocs` treats `listMemories(scope:'permanent')` as a flat array
The tool returns `{ permanent: [...] }` for `scope:'permanent'`; only the legacy
`scope:'fleeting'` returns a flat array (`mcp/index.ts:734-745`). **Effect:** iterating the
result walks object keys, not memory rows. **Fix:** read `result.permanent`, or make the
tool return a flat array for `'permanent'` too.

---

## High / medium findings

| # | Skill / Doc | Finding | Severity | Confirmed |
|---|---|---|---|---|
| H1 | bootstrap | `init.ts:60-63` always pre-creates `system/overview.md`, so bootstrap on a *fresh* workspace **always** emits `overview.draft.md`, never `overview.md`. (Observed in the live run.) Skill never explains this. | high | ✅ (run + code) |
| H2 | propose | No non-destructive `.draft.md` rule — Step 5 `Write`s directly to `system/`, a full overwrite. A wrong gap-analysis or a re-run silently destroys user-committed doc content. `bootstrap` has this guard; `propose` doesn't. | high | ✅ (skill text) |
| M1 | bootstrap | `sources:` frontmatter key for generated docs collides semantically with the memory schema's `sources[]` (= ingestion snapshot paths, `mcp/index.ts:697-700`), polluting `search({filters:{sources}})`. Prefer `linkedMemories:`/`memoryRefs:`. | medium | ✅ |
| M2 | propose | `milestone=<latestMilestoneRef>` in the research prompt — no tool returns such a field. | medium | ✅ (grep) |
| M3 | bootstrap | Step 2 says "skip gracefully if no system collection" but `search` *errors* (not empty) if embeddings aren't ready (`mcp/index.ts:1400-1407`); no error branch. | medium | plausible |
| M4 | sysdoc-assistant | Step 1 mandates a `realpath` canonical scope check, but no `realpath` primitive/Bash is in the skill's documented tool list — degrades to the string-prefix check the rule itself calls insufficient. Severity depends on whether skills actually get `Bash` at runtime (they usually do). | medium | partial |
| M5 | bootstrap | `workspace.repos[]` phrasing (`:65`) implies nesting; `getWorkspaceDetails` spreads `...ws` so `repos` is top-level. Step-1 text (`:26`) is correct; the prompt phrasing is loose. | low/med | ✅ |

Lower-severity items (dead empty-Glob branch in sysdoc-assistant since `init.ts` always
seeds `system/`; draft-name collision on repeated bootstrap runs; no "nothing to propose"
early-exit; concurrent-run TOCTOU on direct `Write`s) are captured in the raw workflow
output and are worth a cleanup pass but don't block.

---

## Generated-doc accuracy (the docs bootstrap produced)

The 10 generated docs are well-structured, correctly scoped to `system/`, and
frontmatter-compliant (description present; `sources` omitted; `## Sources` =
"No prior knowledge found."). Accuracy was strong, with these corrections needed:

- **Milestones are NOT a SQLite table** (appears in `overview.draft.md`,
  `workspaces-and-projects.md`, `data-storage.md`). There is no `milestones` table in
  `schema.ts`; milestones are markdown plan files on disk (`plan/service.ts`,
  `milestone.ts` router) referenced by a `milestoneRef` text column on `taskGroups`/`tasks`.
  **Note:** this same error exists in `web/CLAUDE.md` ("execution state: workspaces,
  projects, milestones, tasks") — the drafting agent inherited it from the project's own
  docs. Worth a boy-scout fix in `web/CLAUDE.md`.
- **Memory subtypes** (`knowledge-layer.md`) are listed as plural dir names
  (`decisions`…); the enum values agents must pass are singular
  (`decision`,`pattern`,`fact`,`convention`,`insight` — `schema.ts:263`). Plurals are the
  on-disk directory names (`SUBTYPE_DIR_MAP`).
- **`registerMemoryTools`** also registers `writeSourceSnapshot` (omitted in
  `knowledge-layer.md`).
- **`search-architecture.md`**: lexical mode is `'lex'`, not `'BM25'` (`qmd-search.ts:3`);
  `indexStatus` up-to-date is `needsEmbedding === 0`, not `unchanged === fileCount` (no
  such field); `autoLink` is awaited in `promoteMemory` (not uniformly fire-and-forget).
- **`api-surface.md`**: tRPC router list omits `execution` and `question` (`root.ts`);
  path objects do **not** include `repos[]` (`resolveWorkspacePaths` returns
  workspaceDir/specsDir/docsDir/memoryDir/systemDir).
- **`client-server-websocket.md`** / **`overview.draft.md`**: the WS protocol is presented
  as ~5 message types but the union has ~45 (git/file/container/execution/terminal-relay/
  memory). Add "among others" or list categories.
- Minor: `simple-git` is used in `web/` too (not daemon-only); `dir.ts`/`project/service.ts`
  mis-attributed to the diff feature in `git-diff-and-file-viewing.md`.

These are drafting inaccuracies, not skill defects — the skill correctly told the agent to
cite real paths; the agent (me) reproduced a couple of errors present in the repo's own
docs. The takeaway for the skill: it could instruct the author to **verify each cited
symbol against the code** rather than trusting CLAUDE.md.

---

## Recommended fix order

1. **B1 + B2** (one edit each in all 3 skills) — restores the entire knowledge-retrieval
   leg. Highest impact, lowest effort.
2. **B3, B4, B5** — make `propose-sysdocs` executable.
3. **H1, H2** — overview-draft surprise + `propose` non-destructive guard (data-loss risk).
4. **M1–M5** + doc-accuracy corrections, including the `web/CLAUDE.md` milestone fix.

## Artifacts

- Generated docs: `web/.dev-engy/sysdoc-validation/system/` (gitignored)
- Full workflow output (all findings, verbatim):
  `/private/tmp/claude-501/-Users-aleks-dev-engy--claude-worktrees-knowledge-system/184ff0a8-c9ba-4cd3-a3ef-101dd5f346ad/tasks/wpf4gsal5.output`
