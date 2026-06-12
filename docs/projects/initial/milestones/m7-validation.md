---
title: M7 Knowledge Layer — Validation Plan
status: in-progress
---

# M7 Validation Plan

Validates the M7 Knowledge Layer implementation in the `worktree-knowledge-system` worktree against `m7-knowledge-layer.plan.md`.

## Environment

- Worktree: `/Users/aleks/dev/engy/.claude/worktrees/knowledge-system`
- Port: **4002** (main engy occupies its usual port; 4000 occupied by something else per the user)
- Data dir: `.dev-engy/` (workspace-local, gitignored, fresh per run)
- Branch: `worktree-knowledge-system`

## What we can validate without a live MCP-connected Claude session

✅ Code-level: type-check, lint, test, knip, jscpd (`pnpm blt`)
✅ All M7 vitest suites — they exercise the full memory + indexer + search + auto-linker + validate + project-completion stack against real SQLite
✅ tRPC surface via direct HTTP — `memory.*`, `search.*`, `dir.*`, `project.*`
✅ UI via playwright-cli — Memory tab, Docs tab, Cmd+K global search, promote dialog
✅ Filesystem + git artifacts — workspace dir layout, README chain regeneration, `memory(<op>):` commit messages
✅ MCP tool implementations — testable directly (functions are exported); we just don't have a real `mcp__Engy__*` client wired into this Claude session

## What requires a Claude session connected to this worktree's MCP (manual)

🔵 End-to-end skill round-trips:
- `/engy:ingest <url|path|text>` — full flow including subagent dispatch
- `/engy:research <question>` — subagent invocation + Task tool
- `/engy:review-memories` — interactive promotion loop
- `/engy:plan` / `/engy:milestone-plan` folding a real research digest into a plan doc
- `/engy:propose-sysdocs` end-to-end
- `/engy:bootstrap-sysdocs`, `/engy:sysdoc-assistant`

The plan smoke-tests the underlying primitives every skill stands on, so any skill failure should reduce to a primitive bug already caught here.

---

## Phase 1 — Code-level gates (agent: `m7-gates`)

Runs in parallel with phases 2 and 3. No server required.

- [ ] `pnpm install --frozen-lockfile` — verify lockfile is in sync
- [ ] `pnpm blt` from worktree root — must pass clean (build + lint + test + knip + jscpd)
- [ ] Targeted M7 test suites — capture per-file pass/fail:
  - `web/src/server/lib/memory-files.test.ts`
  - `web/src/server/trpc/routers/memory.test.ts`
  - `web/src/server/trpc/routers/search.test.ts`
  - `web/src/server/search/qmd-store.test.ts`
  - `web/src/server/search/indexer.test.ts`
  - `web/src/server/search/auto-linker.test.ts`
  - `web/src/server/search/validate.test.ts`
  - `web/src/server/mcp/index.test.ts`
  - `web/src/server/services/project-completion.test.ts`
  - `client/src/runner/agent-spawner.test.ts`
- [ ] Confirm there are no skipped/`.only` tests, no `xit`/`xdescribe`

**Pass criteria:** `pnpm blt` green; every M7 test file green; zero skipped tests.

---

## Phase 2 — Skills/agent file audit (agent: `m7-skills-audit`)

Runs in parallel with phases 1 and 3. No server required.

Verify the following files exist, parse, and reference real tool surfaces:

- [ ] `plugins/engy/agents/engy-research.md` — frontmatter `name: engy:research`, `tools` whitelist contains the unified `search` MCP tool and `Read`, no write tools
- [ ] `plugins/engy/skills/research/SKILL.md` — thin wrapper; dispatches via `Task({ subagent_type: 'engy:research' })`
- [ ] `plugins/engy/skills/ingest/SKILL.md` — references `createFleetingMemory`, source/reference write convention, `memory(ingest):` commit format, `reindex` MCP tool
- [ ] `plugins/engy/skills/review-memories/SKILL.md` — references `listMemories` (or `search`), `promoteMemory`, dup-check via `search`
- [ ] `plugins/engy/skills/propose-sysdocs/SKILL.md` — writes under `system/`, dispatches `engy:research`
- [ ] `plugins/engy/skills/bootstrap-sysdocs/SKILL.md` — codebase read via MCP, dispatches `engy:research`
- [ ] `plugins/engy/skills/sysdoc-assistant/SKILL.md` — scoped to `system/`
- [ ] `plugins/engy/skills/reindex/SKILL.md` — thin wrapper around `reindex` MCP tool
- [ ] `plugins/engy/skills/validate/SKILL.md` — runs validate + reports
- [ ] `plugins/engy/skills/complete-project/SKILL.md` — orchestrates completion → review-memories → propose-sysdocs → archive
- [ ] `plugins/engy/skills/plan/SKILL.md` — UPDATED to dispatch `engy:research` via Task; folds digest into plan with `<!-- engy:research synthesized YYYY-MM-DD -->` markers
- [ ] `plugins/engy/skills/milestone-plan/SKILL.md` — same dispatch pattern
- [ ] `plugins/engy/skills/implement/SKILL.md` — UPDATED to instruct agents to pass `memories[]` via `updateTask` and completion output

**Pass criteria:** every file present, frontmatter valid, references resolve to tools that actually exist in `web/src/server/mcp/index.ts`.

---

## Phase 3 — Live integration validation (agent: `m7-live`)

Boots the dev server on port 4002 against a fresh `.dev-engy/`, drives every primitive end-to-end via HTTP/tRPC, then tears down. Sequential within itself.

### 3a — Boot & workspace init

- [ ] `rm -rf .dev-engy/` to start fresh
- [ ] `pnpm dev` in background; wait for `Ready on http://localhost:4002`
- [ ] `POST /api/trpc/workspace.create` with a name like `m7-validation`; verify response
- [ ] Inspect `.dev-engy/<slug>/`:
  - [ ] `system/README.md`, `docs/README.md`, `projects/README.md`, `memory/README.md` all present with `<!-- INDEX START --> ... <!-- INDEX END -->` markers
  - [ ] `memory/{decisions,patterns,facts,conventions,insights,sources,references}/README.md` all present
  - [ ] Each README has a `description:` frontmatter line
  - [ ] `workspace.yaml` present
- [ ] `git -C .dev-engy/<slug> log --oneline` — initial commit(s) present

### 3b — Memory file pipeline

- [ ] Call `memory.create` tRPC with a permanent memory (subtype `decision`, title, content, tags)
- [ ] Verify file at `memory/decisions/{YYYYMMDDHHmm}-{slug}.md` with full frontmatter
- [ ] Verify `permanentMemories` row in SQLite (use `web/.dev-engy/<slug>/engy.db` or wherever the DB lives — adapt to actual path)
- [ ] Verify `frontmatter` table has matching row with JSON
- [ ] Verify `git log -1 --format=%s%n%b` matches `memory(promote): …` or `memory(create): …` with key:value body
- [ ] Verify `memory/README.md` and `memory/decisions/README.md` regenerated — both contain a bullet linking to the new file with its title
- [ ] Edit the memory via `memory.update`; verify file rewritten, DB updated, new commit, README still consistent
- [ ] Delete via `memory.delete`; verify file removed, DB row gone, frontmatter row gone, parent README index reflects the removal, commit emitted

### 3c — Fleeting memories + promotion

- [ ] Create a fleeting via `memory.createFleeting` (or via `mcp.createFleetingMemory`'s underlying function)
- [ ] Verify it appears in `memory.reviewCandidates` (workspace-scoped, no `projectId`)
- [ ] Call `memory.promote` with type/subtype/title
- [ ] Verify: permanent file written, fleeting marked `promotedAt`/`promotedFromId`, both records consistent
- [ ] Promotion duplicate-check path: create a second very-similar fleeting; promote with skip / supersede / promote-anyway codepaths; verify each

### 3d — Frontmatter cache freshness

- [ ] Write a markdown file via `dir.write` tRPC with frontmatter tags `["foo","bar"]`; verify `frontmatter` row appears immediately
- [ ] Modify tags via second `dir.write`; verify row updated
- [ ] Delete via `dir.deleteFile`; verify row removed
- [ ] **Out-of-band edit**: directly `fs.writeFileSync` a file under the workspace (bypass tRPC); call `search.query` with that file's tag — confirm STALE state (known limitation)
- [ ] Call `reindex` MCP tool / `WorkspaceIndexer.update('memory')`; confirm row appears

### 3e — qmd search

- [ ] Seed 6-10 permanent memories with varied content across `decisions`, `patterns`, `facts`
- [ ] `search.query({ query: 'jwt rotation' })` (or whatever fits the seed) → returns grouped results across collections, with `score`, `path`, `title`, `snippet`
- [ ] `search.query({ filters: { tags: ['auth'] } })` → SQLite JSON1 path returns matching files
- [ ] `search.query({ query, filters })` → narrowed candidate set
- [ ] `search.query({ filters: { linkedMemories: [<id>] } })` → reverse-link query works

### 3f — Auto-linker

- [ ] Create memory A about topic X; create memory B that's also about topic X
- [ ] On B's creation, `autoLink(B.id)` should have run; both files' `linkedMemories[]` contain the other's id, bidirectionally
- [ ] Cap test: create 7 related memories; new memory should auto-link to at most 5
- [ ] Threshold test: create a memory totally unrelated → no auto-link
- [ ] Recursion bound: re-running the indexer on the just-linked memories does NOT trigger another autoLink pass (confirms one-shot semantics)

### 3g — validate skill primitives

- [ ] Call `validate` MCP tool (or its underlying function); against the seeded workspace, expect clean report
- [ ] Manually break things and re-validate:
  - [ ] Orphan a permanent memory file (delete from disk, leave DB row) → reported
  - [ ] Orphan the reverse (DB row, no file) → reported
  - [ ] Manually rewrite a `memory/` commit message to violate `memory(<op>):` format → reported
  - [ ] Add a broken markdown link `[x](does-not-exist.md)` → reported

### 3h — Reindex & status

- [ ] `reindex({ workspaceId, full: false })` → reports per-collection counts; on a no-op rerun `unchanged === fileCount`
- [ ] `reindex({ full: true })` → forces re-embed; `needsEmbedding` count progresses
- [ ] `indexStatus({ workspaceId })` → matches reindex output

### 3i — Project completion + archive

- [ ] Create a project; create a few tasks; populate fleetings linked to that workspace
- [ ] `project.startCompletion` → status `completing`, candidate list returned (all workspace fleetings unpromoted)
- [ ] `project.archive` → sessions+logs deleted, plan/milestones/tasks/permanents/fleetings preserved
- [ ] Verify `agentSessions` table empty for that project; `tasks` table intact

### 3j — Completion-output memories WS path

- [ ] Synthetic agent completion payload with `memories: [{ content, type }]`
- [ ] WS server receives `CREATE_MEMORIES_REQUEST`, inserts fleetings scoped to workspace, `source: 'agent'`
- [ ] Verify schema validation rejects malformed payloads

### 3k — Teardown

- [ ] Kill `pnpm dev`
- [ ] Save server log to `/tmp/m7-validation-server.log`
- [ ] Save full report

**Pass criteria:** every checkpoint above hits expected state; no panics in server log.

---

## Phase 4 — UI smoke via playwright-cli (agent: `m7-ui`)

Runs after `m7-live` confirms the server boots clean. Reuses the same running server, OR boots its own and tears down.

- [ ] Open `http://localhost:4002`, create workspace `m7-ui` (or use an existing one)
- [ ] Docs tab: collapsible `System Docs` / `Shared Docs` headers; `projects/`, `memory/`, `workspace.yaml` are NOT shown
- [ ] Memory tab: two-panel layout; tabs `Permanent` + `Review Candidates`; count badge on `Review Candidates`; filters for type/subtype/repo; tag chips; search input
- [ ] Create a permanent memory via the create form; verify it appears in the browser list
- [ ] Click into the detail view; verify BlockNote editor renders; edit content + save
- [ ] Promote a fleeting via promote dialog; verify type/subtype selectors, dup-check surface (skip if search not yet seeded), confirm flow writes permanent
- [ ] Global Cmd+K: opens command palette; debounced search; results grouped by collection; click result navigates
- [ ] Take screenshots of each surface

**Pass criteria:** every interaction succeeds; no console errors; screenshots saved.

---

## Phase 5 — Manual (user-driven, MCP-connected)

Things to run yourself once you've pointed a Claude Code session at the worktree's MCP:

- [ ] `/engy:ingest <a real URL>` → snapshot + fleeting + commit
- [ ] `/engy:ingest <a Granola meeting ID>` → transcript path (if you have Granola MCP configured)
- [ ] `/engy:research "what do we know about X"` → digest with citations
- [ ] `/engy:review-memories` → interactive promotion of seeded fleetings
- [ ] `/engy:plan` on a throwaway project → plan doc has `<!-- engy:research synthesized -->` block
- [ ] `/engy:propose-sysdocs` → uncommitted edits under `system/` visible in diff viewer
- [ ] `/engy:bootstrap-sysdocs` on a real repo → initial system docs proposed

---

## Reporting

Each agent reports back with:
- Pass / partial / fail per phase
- Per-checkpoint status
- Any deviations between observed and expected behavior
- Server logs on failure
- A short prioritized bug list (severity-tagged)

Final synthesis lands in this file under `## Results`.

## Results

**Run date:** 2026-05-14
**Overall verdict:** **PARTIAL** — code-level pass, one 🔴 design-blocker in dev-only environments, multiple 🟡 polish/correctness items.

### Phase 1 — Code gates (agent: `m7-gates`) — PARTIAL

| Test file | Pass | Fail | Skip |
|---|---|---|---|
| `web/src/server/lib/memory-files.test.ts` | 31 | 0 | 0 |
| `web/src/server/trpc/routers/memory.test.ts` | 36 | 0 | 0 |
| `web/src/server/trpc/routers/search.test.ts` | 32 | 0 | 3 (QMD-gated) |
| `web/src/server/search/qmd-store.test.ts` | 6 | 0 | 0 |
| `web/src/server/search/indexer.test.ts` | 18 | 0 | 1 (QMD-gated) |
| `web/src/server/search/auto-linker.test.ts` | 12 | 0 | 0 |
| `web/src/server/search/validate.test.ts` | 17 | 0 | 1 (FK-unreachable, documented) |
| `web/src/server/mcp/index.test.ts` | 71 | 0 | 0 |
| `web/src/server/services/project-completion.test.ts` | 16 | 0 | 0 |
| `client/src/runner/agent-spawner.test.ts` | 38 | 0 | 0 |
| **Total** | **277** | **0** | **5** |

All five skips are intentional and have explanatory comments (4 are `describe.skipIf(!QMD_AVAILABLE)` guarding on local GGUF availability; 1 is a schema-unreachable orphan case under `onDelete: 'set null'`).

`pnpm blt` fails in the integrated turbo run with **2–6 timeouts** in tests that all pass individually (e.g. `mcp/index.test.ts > indexStatus > should return status with upToDate flag`, `validateWorkspace > should detect orphaned permanentMemory`). Symptom: `Test timed out in 30000ms`. Root cause is CPU/IO contention from `next build` + esbuild + vitest workers running concurrently — not M7 logic. Likely fixes: bump timeouts, reduce vitest pool size in turbo, or sequence `test` after `build`/`lint`.

### Phase 2 — Skills/agent audit (agent: `m7-skills-audit`) — PASS

All 13 M7 skill/agent files exist with valid frontmatter and reference tools that actually resolve:

- **Subagent** `agents/engy-research.md` — `tools: mcp__Engy__search, Read` (read-only, matches plan).
- **New skills** — research, ingest, review-memories, propose-sysdocs, bootstrap-sysdocs, sysdoc-assistant, reindex, validate, complete-project.
- **Modified skills** — plan + milestone-plan dispatch `engy:research` via Task with the `<!-- engy:research synthesized YYYY-MM-DD -->` marker block; implement instructs agents to pass `memories[]` via both `updateTask` and structured completion output.
- All MCP tools registered: `createPermanentMemory`, `updatePermanentMemory`, `promoteMemory`, `createFleetingMemory`, `listMemories`, `search`, `reindex`, `updateTask` (with `memories[]`), `validateWorkspace`, `indexStatus`.

### Phase 3 — Live integration (agent: `m7-live`) — PARTIAL

Drove the full pipeline end-to-end against a live server on port 4002.

| Sub-phase | Result |
|---|---|
| 3a — Boot & workspace init | PARTIAL (gitignore-under-worktree blocker; some top-level READMEs missing) |
| 3b — Memory file pipeline | PASS (after git workaround) |
| 3c — Fleeting + promotion | PASS (dup-check branches live in skill/UI, not tRPC) |
| 3d — Frontmatter cache freshness | PASS — STALE-then-reindex works exactly as documented |
| 3e — qmd search | PARTIAL (filter path clean; hybrid query path has bugs) |
| 3f — Auto-linker | INCONCLUSIVE — no links produced; threshold/race unclear |
| 3g — Validate primitives | PASS minus inline markdown link detection |
| 3h — Reindex & status | PARTIAL — `indexStatus` writes to the index |
| 3i — Project completion + archive | PASS |
| 3j — Completion-output WS memories | PARTIAL (code-review only; no Zod parse on WS) |
| 3k — Teardown | OK — server dead, log at `/tmp/m7-validation-server.log` |

### Consolidated bug list (severity-sorted)

🔴 **`ensureGitRepo` no-ops when `ENGY_DIR` is inside an existing git tree.** Under the worktree (or any nested setup), the first `memory.create` fails with `paths are ignored by .gitignore` and leaves partial state (file on disk, no DB row). Production `ENGY_DIR=~/.engy/` won't hit this, but dev/worktree workflows do. Fix at `web/src/server/engy-dir/git.ts:17`: init a fresh repo for the workspace regardless of ambient git context, or scope all `simpleGit` calls to the workspace path explicitly.

🟡 **`syncPermanentMemoryMirror` ingests `memory/<subtype>/README.md` as memory rows.** Creates phantom `permanent_memories` titled "README", pollutes `search` results, throws `schema-compliance` warnings in `validate`. Filter out `README.md` in `web/src/server/search/indexer.ts:syncPermanentMemoryMirror`.

🟡 **qmd hybrid `query` path returns doubled paths (`memory/memory/...`) and slug-based titles.** Tag-filter path is correct; the hybrid renderer in `qmd-store` is wrong. This also explains why `query + filters` returns `[]` — join key mismatch against the SQLite frontmatter path.

🟡 **`validateWorkspace.checkBrokenLinks` only inspects DB-tracked `linkedMemories`/`sources`,** never parses body markdown. A literal `[x](does-not-exist.md)` inline link is not flagged.

🟡 **WS `CREATE_MEMORIES_REQUEST` has no Zod parse.** Malformed payloads will throw uncaught or silently no-op. Plan claimed schema validation at this layer — not implemented.

🟡 **`indexStatus` MCP tool is not read-only** — calls the same `indexerUpdate` path as `reindex`, mutating state. Rename or split.

🟡 **First hybrid query takes 5–6 minutes** while embedding model loads, with no log/UX signal. Add a startup log line; consider a `Warming up local model…` response.

🟡 **`pnpm blt` flaky under parallel load** (see Phase 1) — not M7 logic, but blocks the gate.

🟡 **Auto-linker did not produce links in a 7-memory fixture** despite confirmed `embed complete: 12 docs`. Either the 0.75 hybrid threshold is too high for short snippets, or `autoLink()` raced ahead of embeddings (it's fire-and-forget after `memory.create`/`memory.promote`). Worth instrumenting and adding a deterministic integration test.

🔵 `memory.create` always emits `memory(promote):` commits (never `memory(create):`).

🔵 README bullet summaries pull the first content line, not the frontmatter `title`; pluralization shows "(1 notes)".

🔵 Top-level `system/README.md`, `docs/README.md`, `projects/README.md` are missing despite the plan's FR-TG1.11 mention; only `memory/README.md` is generated. Verify intent — may be plan wording, may be implementation gap.

🔵 First-boot tsx watcher restart storm (~90s) because the worktree shares `node_modules` symlinks with the parent monorepo. Cosmetic; recoverable.

### Open questions (for the user / implementer)

1. Is `ensureGitRepo` skip-under-parent-repo deliberate (so workspace commits ride the parent history when nested), or an oversight? If deliberate, the worktree dev workflow needs `ENGY_DIR` outside the parent tree.
2. Should `syncPermanentMemoryMirror` skip `README.md`, or should it treat any `.md` under `memory/<subtype>/` as a memory? Plan implies the former.
3. The qmd `memory/memory/...` path-doubling — is this a known bug?
4. The dup-check `skip` / `supersede` / `promote-anyway` modes on `memory.promote` are not in the tRPC zod input. Are they UI/skill-only by design?

### Phase 5 — Still owed (manual, MCP-connected)

The skill round-trips below still need a Claude Code session whose MCP points at this worktree's server. Each exercises code paths smoke-validated above, so failures here should be skill-prompt or composition bugs, not pipeline bugs.

- `/engy:ingest <real URL>` and `/engy:ingest <Granola meeting>`
- `/engy:research "<question>"`
- `/engy:review-memories`
- `/engy:plan` and `/engy:milestone-plan` (verify the synthesized marker block lands)
- `/engy:propose-sysdocs` and `/engy:bootstrap-sysdocs`

---

## Review-fix run (2026-06-10, branch `m7-review-fixes`)

Validation of the post-merge deep-review fixes (compensating actions, broadcasts, MCP↔tRPC parity, workspace git lock, CREATE_MEMORIES_EVENT protocol cleanup, subtype relocation, provenance inheritance, skills/doc drift). Server booted fresh on port 4100, workspace `m7-validation` seeded via MCP with 8 zettel-shaped permanents (per the eval plan's corpus-shape requirement) + 3 fleetings + 1 source snapshot.

### Live results

- **3a init** PASS — all collection + subtype READMEs seeded with INDEX markers and `description` frontmatter; init commit now `memory(init): initial workspace structure` (conformant).
- **3b file pipeline** PASS — `memory(create):` commits (no longer mislabelled `promote`), README chains regenerate, structured commit bodies.
- **3c promotion** PASS — `promoteMemory` without `sources` inherits the fleeting's `sources[]` (provenance fix verified live); `promotedFromId`/`promoted` set.
- **3e search** PASS — hybrid query ranks the right memory; filters-only exact (tags/subtype); reverse-link query works; query+filters narrows.
- **3f auto-linker** PASS — bidirectional links written for the genuinely-similar pair only (0.75 threshold held); `memory(autolink):` commit carries `memory_id` + `linked:` body; links survive (and follow) subtype relocation via inbound-link rewriting.
- **3g validate** PASS — caught a real broken link mid-test; after fixes reports no errors; README files excluded from schema/orphan checks; commit lint now sees non-add commits.
- **3i completion** PASS — `archiveProject` from `planning` rejected with descriptive error; `startCompletion → archive` happy path works.
- **Phase 4 UI** PASS — Memory tab two-panel layout, Review Candidates badge (2) matches list, detail view with tags/themes/keywords/linked-memories, Cmd+K palette returns grouped results and navigates; 0 console errors.
- **Gates** — `pnpm blt` green (web 1232 passed / 6 skipped, client 243, knip + jscpd clean); `/engy:review` findings (3 high / 12 medium) all fixed and re-validated.

### Known remaining (pre-existing, tracked for eval phase)

- Hybrid search results render slug-derived titles instead of frontmatter `title`, and README TOC files pollute qmd results (broad-vocabulary false positives — the eval plan's corpus-shape concern). Both live in the qmd result rendering/collection config, not the fix scope.
- Tasks deep-linking from global search lands on the tasks tab without selecting the task (tasks page has no URL-based selection mechanism).
- Worktree dev gotcha: a worktree created with node_modules symlinked to a sibling worktree breaks turbopack ("symlink points out of filesystem root", blanket 404s) — fix by removing the symlinks and running `pnpm install` in the worktree. Do NOT set `turbopack.root`: it breaks Tailwind resolution.

## Adversarial-fix run (2026-05-28)

Follow-up run addressing findings from the adversarial review of the M7 skills/agent surface and three server-side gaps. Verdict: **GREEN** — targeted suites and `pnpm blt` both pass.

### Server fixes

1. **`writeSourceSnapshot` MCP tool** — promoted snapshot writing from a raw `Write` to a real MCP tool with SHA-256 content dedup. `SourceSnapshotFrontmatter` gained `origin` + `ingested_at`. New tool params `{ workspaceId, title, content, slug?, url?, origin?, sourceType, ingestedAt? }`; maps `sourceType → source_type`, hard-codes `ingester: 'mcp'`, returns `{ filePath, reused }`. Signature: `writeSourceSnapshot(workspaceDir, fm: Omit<SourceSnapshotFrontmatter, 'content_hash'>, body): Promise<{ filePath; deduplicated }>`.
2. **Supersession persistence** — `supersededBy?: string` (workspace-relative path) added to `PermanentMemoryFrontmatter`; written by `writePermanentMemory`/`rewritePermanentMemory`, parsed by `readPermanentMemory`. Both the MCP `updatePermanentMemory` and the tRPC `update` router now accept `supersededById`, resolve the superseding memory's `filePath`, and persist `supersededBy` into the superseded file's frontmatter. `syncPermanentMemoryMirror` resolves `supersededBy → id` on sync and omits the key when absent so the existing DB value is preserved.
3. **`listMemories` permanent scope** — added `scope: z.enum(['fleeting','permanent','both']).default('fleeting')`. `fleeting` keeps the backward-compatible flat array; `permanent` returns `{ permanent: [...] }` with full metadata (subtype, title, keywords, themes, tags, filePath, supersededById); `both` returns `{ fleeting, permanent }`. `compact` consistently omits `content` across all scopes.

Server tests: 4 targeted suites green, 182 passed / 2 skipped (QMD embed-gated); 12 new focused tests added, 3 implementation bugs fixed.

### Skill/agent fixes (by file)

- **`skills/ingest/SKILL.md`** — snapshot branch now calls `mcp__Engy__writeSourceSnapshot` instead of raw `Write`; Step 6 uses explicit `git add <paths>` (forbids `git add -A`/`.`); added PII/safety redaction prompt before commit (transcripts, emails, contact details); resolved the Step 5 vs Step 6 "do not commit" contradiction; added a partial-failure recovery note to Step 4.
- **`skills/review-memories/SKILL.md`** — supersede now durable (writes `supersededById` to DB + frontmatter); contradiction now durable via `createFleetingMemory` tagged `contradiction` referencing both ids; added prompt-injection guard treating fleeting bodies as UNTRUSTED; switched sibling lookup to `listMemories({ scope: 'permanent' })`; added a provenance caveat to `sibling-evolution.md`.
- **`skills/knowledge-research/SKILL.md`** — resolves `workspaceId` via `listWorkspaces` before dispatch and threads it into the Task template (errors without it).
- **`skills/complete-project/SKILL.md`** — `listWorkspaces` added to resolve `workspaceId`; documented the Skill-invocation contract (inner skill runs to completion, re-resolves its own context).
- **`skills/bootstrap-sysdocs/SKILL.md`** — non-destructive rule: write `<name>.draft.md` when a canonical file exists instead of overwriting.
- **`skills/sysdoc-assistant/SKILL.md`** — scope rule hardened from string-prefix to canonical-path check via `realpath` (rejects `..` traversal and symlinks resolving outside `system/`).
- **`skills/propose-sysdocs/SKILL.md`** — uses `listMemories({ scope: 'permanent' })` directly instead of fetch-all-then-filter; zero-findings text + synthesized marker form normalized.
- **`skills/reindex/SKILL.md`** — added a `full: true` cost-gate confirmation prompt.
- **`skills/validate/SKILL.md`** — frontmatter/description conventions only.
- **`agents/engy-research.md`** — BFS hard cap is now dual: stop at 10 nodes **or** ~60 KB of body content read; footer templates show both budgets.
- **Shared across all** — third-person `description` frontmatter with quoted trigger phrases; one-line note that MCP tools are `mcp__Engy__*` normally and `mcp__EngyWorktree__*` in a worktree session.

### Validation result

- **Targeted M7 suites:** 5 files, 226 passed / 5 skipped (231 total).
- **`pnpm blt`:** all 9 turbo tasks green — build OK, full test run 945 passed / 6 skipped (951 total), lint 0 errors (4 pre-existing warnings), knip + jscpd clean.
- **Known-flaky note:** the first sandboxed `pnpm blt` reported 42 `EPERM: mkdir '/tmp/.../ssr'` failures from vitest writing outside the sandbox writable allowlist — a sandbox FS restriction, **not** a code regression. Re-running unsandboxed produced a fully green result; `bltGreen` reflects the unsandboxed run. No vitest timeouts observed (contrast with the 2026-05-14 parallel-load flakiness).

