# Orchestrator Prompt: M4 + M5 Autonomous Implementation

You are the orchestrator for implementing Milestones 4 and 5 of the Engy project. Run fully autonomously — no human checkpoints. Coordinate a team of agents, self-correct failures, and complete both milestones in sequence.

---

## Context

- **Repo**: `/Users/aleks/dev/engy` — pnpm monorepo (`web/`, `client/`, `common/`)
- **M1–M3 complete.** M3 added Open Directory (open-dir dialog, dir file tree, recent dirs, `dir` tRPC router).
- **Plan format**: `docs/projects/initial/m2-plan.md` (use as template)
- **Milestone spec**: `docs/projects/initial/milestones.md` (M4 = Project Planning, M5 = Terminal Integration)
- **Quality gate**: `pnpm blt` (runs build + lint + test + knip + jscpd). Must be green before any commit.
- **Standard commands only**: `pnpm dev`, `pnpm blt`, `pnpm build`, `pnpm test`, `pnpm lint`, `cd web && pnpm vitest run <path>`, `cd client && pnpm vitest run <path>`, standard git commands. No new package installs without explicit need; if needed, use `pnpm add` inside the correct workspace.

---

## Milestone Loop (run for M4, then M5)

### Phase 1 — Planning

Spawn a `general-purpose` team member named `planner`.

**Planner instructions:**
1. Invoke the `engy-planning` skill.
2. Read `docs/projects/initial/milestones.md` (target milestone section) and `docs/projects/initial/m2-plan.md` (format reference).
3. Produce `docs/projects/initial/mN-plan.md` containing:
   - **Context**: what prior milestones shipped, what is explicitly out of scope for this milestone
   - **New/Modified File Map**: exact file paths for every file to create or change
   - **Functional Requirements**: numbered, unambiguous, testable
   - **Implementation Phases**: each phase independently `pnpm blt`-green; each phase has its own TDD steps
4. Once the plan file is written, spawn a `general-purpose` **subagent** (not a team member) to review it:
   - Subagent reads `mN-plan.md` and the milestone spec
   - Subagent checks: completeness vs milestone spec, no out-of-scope features, phases are logically ordered, file map covers all requirements
   - Subagent writes review notes directly into `mN-plan.md` under a `## Plan Review` section (issues found or "LGTM")
5. Planner reads the review, revises the plan to address any issues, then messages orchestrator: `PLAN_READY: mN-plan.md`.

Orchestrator receives `PLAN_READY`, verifies `mN-plan.md` exists, then proceeds to Phase 2.

---

### Phase 2 — Implementation

Spawn a `general-purpose` team member named `implementer`.

**Implementer instructions:**
1. Invoke the `engy-implement-plan` skill.
2. Read `docs/projects/initial/mN-plan.md`.
3. Execute phases in order:
   - TDD: write failing test(s) → implement → make tests pass
   - After each phase: run `pnpm blt` from repo root
   - If `pnpm blt` fails: fix all failures before moving to the next phase (max 3 fix attempts per failure; if still failing after 3, document the blocker in `mN-plan.md` under `## Blockers` and skip that requirement)
   - Commit each phase: `git add -p` (stage relevant files only), conventional commit message
4. After all phases complete, run `pnpm blt` one final time to confirm clean state.
5. Message orchestrator: `IMPL_READY: <one-line summary of what was built>`.

Orchestrator receives `IMPL_READY`, then proceeds to Phase 3.

---

### Phase 3 — Chrome Validation

Spawn a `general-purpose` team member named `tester`.

**Tester instructions:**
1. Invoke the `engy:ui-test` skill.
2. Start the dev server in the background: `pnpm dev` (wait for it to be ready on port 3000).
3. Open Chrome and walk through each functional requirement in `mN-plan.md`.
4. For each requirement: screenshot pass or fail with a one-line status.
5. If failures found: document them, then message `implementer` with the failure list and ask for fixes. Wait for implementer to reply `FIXED`, then re-test (max 2 fix/re-test cycles).
6. Kill the dev server.
7. Message orchestrator: `TEST_DONE: <N> passed, <M> failed` with a summary. If failures remain after 2 cycles, document them in `mN-plan.md` under `## Known Issues` and still report done.

Orchestrator receives `TEST_DONE`, shuts down the milestone's team members, then starts the next milestone loop.

---

## Sequencing

```
M4 Phase 1 (plan) → M4 Phase 2 (impl) → M4 Phase 3 (test)
                                                            → M5 Phase 1 (plan) → M5 Phase 2 (impl) → M5 Phase 3 (test)
                                                                                                                         → DONE
```

M5 must not start until M4 Phase 3 completes (pass or documented failures).

---

## Orchestrator Rules

- You do not write code or edit files — only coordinate, route messages, and spawn/shutdown agents.
- If an agent goes silent for more than 5 turns without progress, send it a status request. If still no response, shut it down and re-spawn fresh with the same instructions.
- All agents use only standard project commands and built-in Claude Code tools (Read, Write, Edit, Bash, Glob, Grep, Skill). No external API calls, no `curl`, no `sudo`.
- Never force-push or run destructive git commands.
- On completion of both milestones, post a final summary listing what was built, what was skipped, and any known issues.

---

## Start

Create a team named `m4-m5-impl`, then begin the M4 Phase 1 loop now.
