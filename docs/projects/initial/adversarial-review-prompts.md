# Adversarial Plan Review Prompts

Four parallel reviewer prompts for adversarial review of milestone plan documents. Each takes a different angle; running them in parallel produces complementary findings that are more thorough than a single pass.

## How to use

Dispatch all four as `general-purpose` subagents in parallel (single message, multiple Agent tool calls). Each gets the path to the plan file and a focused remit. Combined wall time ≈ longest reviewer; combined coverage is much better than any one alone.

When the reviewers return, synthesize findings:

1. Deduplicate (multiple reviewers often flag the same issue from different angles — that's signal it's real).
2. Sort by severity (CRITICAL → MAJOR → MEDIUM → MINOR).
3. Separate "fix in plan" from "out of scope" from "implementation detail."
4. Present to the user with a recommendation.

Adjust the plan path in each prompt to match the document under review. The `<!-- placeholders -->` mark spots where you may want to tune the prompt to the specific plan's domain.

---

## 1. Internal consistency reviewer

```text
Read <PLAN_PATH> end-to-end and find INTERNAL CONSISTENCY problems. This plan
has been edited many times; I need you to be adversarial about finding
self-contradictions, stale references, and conflicts.

Specifically look for:

1. **FR ↔ Task conflicts.** Every FR-TG#.# should be implemented by at least
   one task. Every task should reference its FRs. Are any FRs orphaned (no
   task implements them)? Are any tasks doing work not covered by an FR?

2. **Stale references.** <list any concepts the plan once had but explicitly
   removed in earlier rounds — e.g., "log.md, lastIndexedSha, file watcher,
   mtime/checksum tracking, daemon-driven git ops, syncFromFiles">. Are
   there any remaining mentions, leftover assumptions, or now-broken
   dependency chains?

3. **Cross-section conflicts.** The Overview, Boundary, Memory Layout,
   Out-of-Scope, and Spec Drift sections describe the same things from
   different angles. Are they consistent? Does Out-of-Scope contradict any
   FR? Does Spec Drift list what it should?

4. **FR numbering/ordering.** Any gaps, duplicates, or out-of-order entries
   in FR-TG1.x, FR-TG2.x, FR-TG3.x, FR-TG4.x?

5. **Task dependency claims.** Each task lists "depends on X". Are the
   dependencies consistent with what those upstream tasks actually deliver?

6. **Architectural claims.** If the plan has architectural notes (e.g.,
   "indexer is code, not agent"; "git ops are server-side"), do later task
   descriptions still respect them? Any task that contradicts these notes
   by implication?

7. **Naming consistency.** Skill names, agent names, table names, path
   conventions — used consistently across all sections?

8. **Schema field consistency.** Tables described in FR text and in task
   descriptions — same fields in both? Schemas defined once, referenced
   consistently?

Report findings under 600 words. Group by issue type. Cite line numbers
(grep -n is your friend). Be specific — don't say "consistency could be
improved", say "line X says Y but line Z says ¬Y". Only report real issues;
if everything checks out in a category, say "no issues found" briefly.
```

---

## 2. Gaps reviewer

```text
Read <PLAN_PATH> end-to-end. <one-line summary of what the plan covers>.

Your job: find GAPS — things the plan should specify but doesn't. Be
adversarial. Don't flag intentional out-of-scope items (the Out-of-Scope
section lists those — respect it). Focus on things that an implementer
would hit and not know how to handle.

Specifically:

1. **Data flow gaps.** When skill A produces output for skill B — is the
   handoff specified? When the user is supposed to review something — where
   does that review happen?

2. **Lifecycle gaps.** What happens when:
   - User deletes a file directly via filesystem (not via UI)?
   - User does git revert on a relevant commit?
   - An external dependency (URL, MCP, model) is unavailable?
   - The DB gets out of sync with files (e.g., manual SQLite edits)?

3. **Concurrency gaps.** Two skills running simultaneously. Does the plan
   address ordering, locking, or "last write wins"?

4. **Authentication/permissions.** Sensitive content handling? gitignore?
   Trust boundaries?

5. **Migration gaps.** Existing rows/state when schema changes — preserved?
   Dropped? Backfilled?

6. **UI gaps.** Where does the user invoke X? See Y? How does the existing
   UI accommodate the new feature?

7. **Error/failure handling.** Mid-operation crashes — what state? Recovery
   semantics?

8. **Initial state / bootstrap.** Pre-existing state from before this
   milestone — does the plan describe how it gets brought up to date?

9. **Test/QA gaps.** Does the plan call out testing strategy? Test files?
   BDD scenarios?

10. **Out-of-scope completeness.** Things that probably should be
    Out-of-Scope but aren't called out?

Report findings under 600 words, grouped by category. Be concrete — quote
what's missing. If a category has no issues, say so briefly.
```

---

## 3. Implementation feasibility reviewer

```text
Read <PLAN_PATH> end-to-end. The codebase is at <REPO_ROOT> — <stack
description: e.g., Next.js + tRPC + Drizzle/SQLite monorepo with web/,
client/, common/ packages, plugins under plugins/...>.

Your job: adversarial **implementation feasibility** review. Could an
engineer pick this plan up and build it? Where would they get stuck or have
to make undocumented decisions?

Specifically:

1. **File path concreteness.** Does every task list specific files to
   create/modify with paths from the workspace root? Any tasks where the
   file paths are vague or missing?

2. **Schema definitions.** Tables described in prose. Is there enough info
   to write the schema (column names, types, nullability, FKs, indexes)?
   What's missing?

3. **API contract concreteness.**
   - tRPC procedures: input/output types defined or implied?
   - MCP tools: zod schemas implied? Return shapes?
   - WebSocket messages: protocol additions described?
   - Skill frontmatter declarations: described?
   - Subagent definitions: tools whitelist, system prompt shape — defined
     or hand-waved?

4. **Library/dependency assumptions.** Specific APIs called out? Versions
   pinned? Any unstated dependencies?

5. **Execution mechanics for skills.** Skills call subagents and MCP tools.
   Is the mechanism clearly specified — including what happens to results?

6. **<Domain-specific concretes — replace per plan>** (e.g., for a
   wiki/index plan: TOC format pinning; for a UI plan: component contract
   pinning).

7. **Parser/format assumptions.** What library? What happens on malformed
   input?

8. **Git integration specifics.** When repo is initialized? Commit author?
   Concurrent commits?

9. **Background/async work triggering.** Sync vs async? Queue mechanism?
   Failure handling?

10. **Testing/validation.** Test-writing requirements per task? Coverage
    thresholds?

11. **First-run / install.** Anything that downloads, caches, or
    initializes on first use?

Report findings under 700 words, grouped by category. For each gap, cite
which task it affects. Be specific about what's missing vs what's
"implementation detail OK to leave to dev".
```

---

## 4. Red-team failure modes reviewer

```text
Read <PLAN_PATH>. <one-line summary>.

Your job: adversarial **red-team review**. Be hostile and skeptical. What
could go wrong, get abused, fail catastrophically, or produce unintended
behavior?

Specifically:

1. **Race conditions.** Multiple writes hitting the same data. Background
   work running while user-driven work is in flight. What scenarios break?

2. **Recursion / amplification.** A → B → A loops. Fan-out scenarios. Is
   the bounding really there or does it just sound like it is?

3. **Storage explosion.** Append-only data. Unbounded growth. Any limits,
   retention policy, or warnings?

4. **Adversarial inputs.** Malicious or weirdly-structured input — can it
   corrupt state, escape sandboxes, or trigger unintended behavior? (Path
   traversal, marker injection, conflicting field names, etc.)

5. **Trust boundaries.** Where does the plan assume "this won't happen"?
   What review gates exist? Are they enforceable?

6. **LLM determinism / drift.** Any LLM-driven decisions? Same query at
   different times = potentially different results. Is the user's mental
   model addressed?

7. **Hash collisions / content addressing edge cases.**

8. **Backwards compatibility.** Schema changes. Existing callers. UI
   components referencing now-dropped fields.

9. **Search result poisoning / injected content.** Could a malicious-looking
   record ride into search results and mislead future work?

10. **Performance cliff.** Where does the design break down at scale?

11. **Failure recovery.** Crashes mid-update. Partial writes. Are these
    atomic?

12. **Footguns** — specific user actions that produce surprising results
    (idempotency, double-runs, etc.).

13. **Auto-modification paths.** Anything that writes without explicit user
    consent? Should anything?

14. **Auth/secrets leak.** Sensitive content getting into indexed/searchable
    state.

Report under 700 words. Group findings by severity: CRITICAL (will fail in
production), MAJOR (significant footgun), MINOR (worth noting). Be concrete;
quote the plan when finding the issue.
```
