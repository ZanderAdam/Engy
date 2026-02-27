# Spec Review: Engy 2.0 Workspace Model

## Overall Assessment

This is a strong vision document. The problem statement is sharp, the core insight (separating permanent organizational scope from ephemeral execution scope) is sound, and the file-first storage architecture is a genuinely good idea for a tool like this. The SDD loop with system docs closing the feedback cycle is the most interesting part of the design.

That said, treating this as a greenfield implementation spec, there are real gaps between what's described and what you'd need to actually build it. The critique below is organized from most to least critical.

---

## 1. The Spec Conflates Two Things

The document is doing double duty as both a **vision document** (what Engy should become) and an **implementation spec** (what to build). It's good at the first and insufficient for the second.

For example, the "Worktree Strategy" section explains *why* task groups are the right granularity (convincingly), but doesn't specify: how does a task group get created? Is it explicit user action, inferred from task metadata, or proposed by an agent during planning? What happens when a task moves between groups? Can a group span milestones?

The "Memory Architecture" section similarly explains tiers and promotion conceptually but doesn't define what a memory record actually contains, how promotion decisions get made concretely, or what "the ACE Reflector" is (referenced twice, never defined).

**Recommendation:** Before implementation, decide whether this stays as a vision doc (and you write separate implementation specs per subsystem) or whether you want to flesh this out into something buildable. The current in-between state will lead to ambiguous implementation decisions.

---

## 2. System Doc Updates Are the Hardest Part (and Underspecified)

The system doc feedback loop is the spec's best idea and also its riskiest bet. The claim is: when a project archives, an agent reads completed tasks, the plan, and decisions, then patches the relevant system doc files. This is presented as almost mechanical, but it's actually an extremely hard AI problem.

Concerns:

- **Accuracy compounding.** If an agent writes a slightly inaccurate system doc update, and future specs are written against that inaccurate context, errors compound. The spec acknowledges this in Known Pitfalls ("Bad updates compound. May need human review step initially") but "initially" is doing heavy lifting. This probably needs human review *always*, or at minimum a diff-review workflow.

- **Granularity of updates.** "Delta, not rewrite" — but how does the agent know which system doc files to touch? A project that adds auth refresh touches `authentication.md`, `api.md`, maybe `database.md`. The agent needs to understand the system doc taxonomy to know where to write. What if the right file doesn't exist yet?

- **Conflicting updates.** Two projects complete around the same time, both touching `authentication.md`. How are conflicts resolved? Git merge? Sequential application? This is a real scenario with parallel projects.

**Recommendation:** Design the system doc update as an explicit, reviewable step — not something that happens automatically on archive. Treat it like a PR against the system docs: agent proposes a diff, human (or a review agent) approves. Also specify how the system doc taxonomy itself evolves (who creates new files, when).

---

## 3. The Spec→Project Transition Needs More Detail

"When a spec is approved, it becomes a project" — but the mechanics are vague. Questions:

- **Who/what does the planning?** The spec mentions "agent decomposes into milestones → groups → tasks" but doesn't define the planning step. Is there a planning prompt? Does the user provide the decomposition? Is it iterative?

- **What carries over?** The spec says the project "links back to the spec dir." But does the spec directory get copied, moved, or just referenced? If referenced, the spec dir is mutable while the project is executing — is that intentional?

- **Partial specs.** Can a spec spawn multiple projects? ("Phase 1" and "Phase 2" from one spec?) Or does one spec = one project always?

- **Spec lifecycle after project creation.** Once a spec becomes a project, what's the spec's status? Can it be edited? Does it remain a living document or freeze?

**Recommendation:** Add a "Spec → Project Transition" section that walks through the concrete steps: approval trigger, what gets created, what gets linked vs. copied, and how the planning decomposition works.

---

## 4. Task Groups Are Underspecified

Task groups are central to the execution model (they're the unit of worktrees, PRs, and parallelization), but their lifecycle is thin:

- **Creation.** How are groups created? During planning? Can a user create one manually? Can an agent propose regrouping mid-execution?

- **Modification.** Can tasks move between groups after creation? What happens to the worktree if a task is removed from a group that's in progress?

- **Failure modes.** What if one task in a group fails validation? Does the whole group block? Can you ship a partial group?

- **Group completion.** "Group completes → PR created" — is this automatic? Who reviews the PR? What if the PR has merge conflicts?

- **Cross-repo groups.** The spec shows a group touching `[engy-api, engy-app]` with "worktree in each repo." But a PR is per-repo. So a cross-repo group produces multiple PRs? How are they coordinated?

**Recommendation:** Task groups need their own state machine (proposed → active → PR-open → merged → cleaned-up) and explicit rules for each transition.

---

## 5. Slug Convention Has an Ambiguity

The spec proposes path-style slugs: `engy/auth-revamp/T150`. But it also says "the slug carries through: `auth-revamp` as a spec dir → `auth-revamp` as a project." This means:

- The spec lives at `.engy/specs/auth-revamp/`
- The project lives at `.engy/projects/auth-revamp/`
- Both use the slug segment `auth-revamp`

What prevents naming collisions between specs and projects that aren't related? If I create a spec called `auth-revamp` and separately a project called `auth-revamp` that didn't come from that spec, the filesystem is fine (different parent dirs) but the slug namespace could get confusing.

More importantly: unscoped tasks use the pattern `engy/T200` (two segments). But the spec also says workspace-level docs use `engy/D134` (two segments). What about workspace-level memories? Specs themselves? The two-segment namespace is getting crowded.

**Recommendation:** Either make the slug include a type prefix (`engy/t/T200`, `engy/d/D134`, `engy/s/auth-revamp`) or accept that the second segment's type is inferred from format (T-prefix = task, D-prefix = doc, alphanumeric = project/spec). The current spec implies the latter but should be explicit.

---

## 6. File-First Has Real Tradeoffs Worth Acknowledging

The "files as source of truth, databases as indexes" architecture is a good call for this kind of tool. But the spec is too bullish on it and glosses over practical issues:

- **Atomicity.** Creating a task group with 5 tasks means writing 5 files. If the process crashes after writing 3, you have an inconsistent state. Databases give you transactions; files don't. `engy reindex` handles the read path but doesn't help with write-path atomicity.

- **Concurrency.** Two agents working in parallel, both writing to `.engy/projects/auth-revamp/tasks/`. File-level locking? Git-level coordination? The spec doesn't address concurrent writes at all.

- **Performance at scale.** "Fine for 20-50 tasks per project" — but what about the workspace level? If you have 20 archived projects with 30 tasks each, `engy reindex` is walking 600+ files, parsing YAML frontmatter for each, rebuilding SQLite and ChromaDB. That's not instant. The spec should set expectations or describe incremental indexing.

- **ID generation.** Tasks use sequential IDs (T150, T151). How are these assigned without a central counter? File-based systems typically struggle with this — you'd need to scan the directory to find the next available ID, which has race conditions.

**Recommendation:** Add a section on write-path guarantees. Even if the answer is "we accept eventual consistency and `reindex` is the recovery mechanism," that should be an explicit design decision, not an oversight. Consider a simple write-ahead log or lock file for the `.engy/` directory.

---

## 7. Memory Architecture Needs Concrete Schemas

The memory section describes tiers (workspace, repo, project) and lifecycle (fleeting → permanent, promotion on archive) but never shows what a memory record actually looks like. For a file-first system, this matters a lot:

- What's the filename convention for memories?
- What's in the frontmatter? (type, scope, confidence, source, linked entities?)
- How big is a typical memory? One sentence? A paragraph?
- What distinguishes a "decision" memory from a "pattern" memory from a "convention" memory?
- How does deduplication work? If two projects learn the same thing, do you get two workspace memories?

The "ACE Reflector" is referenced as the mechanism for memory triage and promotion but is never defined. Is it a specific prompt? A pipeline? An external system?

**Recommendation:** Show a concrete memory file example (like you did for tasks) and define the memory types/schema. Either define or remove the ACE Reflector reference.

---

## 8. Repo Memory Is Interesting but Architecturally Unclear

Repo memory is described as "the universal join key across workspace boundaries" — memories scoped to a repo rather than a workspace. This is a compelling idea (knowledge about a codebase should follow the codebase, not the org structure), but raises questions:

- **Where do repo memories live on disk?** The filesystem structure shows `memory/` at workspace and project levels, but no repo-level memory directory. Are repo memories in the workspace's `.engy/memory/` with a `repo` field in frontmatter? Or in the repo itself (e.g., `engy-api/.engy/memory/`)?

- **Cross-workspace access.** If workspace A and workspace B both touch `shared-lib`, and workspace A learns something about `shared-lib`, how does workspace B's agent find that memory? If it's in workspace A's `.engy/` directory, workspace B needs to know to look there. If it's in `shared-lib`'s own `.engy/`, then every repo needs an `.engy/` directory.

- **Git implications.** If repo memories live in the repo, they're committed to that repo's git history. Is that desirable? Are implementation-memory commits cluttering the repo's log?

**Recommendation:** Pick a concrete storage location for repo memories and trace through the cross-workspace access story end to end.

---

## 9. Archival Mechanics Are Thin

"When all work is done, the project archives" — but:

- **What triggers archival?** All tasks completed? Manual action? All PRs merged?
- **What "freezes" mean concretely.** Are files moved to `.archived/`? Made read-only? Just flagged in frontmatter?
- **Partial archival.** What if 90% of tasks are done and the last one is abandoned? Can you archive with incomplete work?
- **Unarchival.** Can an archived project be reopened? (Scope creep discovered post-archive, or a bug found in the shipped work?)

**Recommendation:** Define the archive state machine with explicit triggers and actions.

---

## 10. Missing: Multi-User / Collaboration Model

The spec assumes a single-user workflow throughout. But `.engy/` is git-tracked, which implies collaboration. Questions that arise:

- Can two people work on different projects in the same workspace simultaneously?
- How do memory writes from different users interact?
- Is there any access control, or does everyone have full read/write on everything?

If this is intentionally single-user-first, that's fine — just state it. But the git-based architecture implies collaboration, and the design should acknowledge what happens when two people push conflicting `.engy/` changes.

**Recommendation:** Add a "Scope" or "Assumptions" section stating single-user-first, with a note on what changes for multi-user.

---

## 11. Missing: Error Recovery and Failure Modes

The spec describes the happy path thoroughly but says nothing about failure recovery:

- Agent crashes mid-task-group execution. What state is the worktree in? How do you resume?
- `engy reindex` finds corrupted/malformed frontmatter in a task file. Skip it? Fail? Fix it?
- A system doc update produces nonsense. How do you roll back? (Git revert, presumably, but that also reverts any other changes in that commit.)
- ChromaDB index gets corrupted. Is reindex from files sufficient to fully rebuild, including embeddings?

**Recommendation:** A "Recovery" section covering the main failure modes and their resolution paths.

---

## 12. Minor Issues

- **Validation command.** `engy validate` is mentioned once for broken link detection. It should probably also validate frontmatter schemas, required fields, slug format compliance, and memory schema correctness. Worth expanding.

- **The dashboard example** (§ Active Work Dashboard) shows percentage progress derived from milestones. But milestone completion status isn't defined — is it "all task groups under this milestone are merged"? "All tasks are complete"? This seems simple but affects the dashboard accuracy.

- **"Unscoped tasks/docs"** are mentioned as workspace-level ambient work but never given a filesystem location. Do they live in `.engy/tasks/` at the workspace root? `.engy/projects/_unscoped/`? The hierarchy diagram shows them at the workspace level but the filesystem structure doesn't have a home for them.

- **Plan docs** are referenced in the task frontmatter (`planSlug`) and in the project directory (`plans/`), but the spec never defines what a plan doc is, what it contains, or how it relates to the spec.

---

## Summary of Key Recommendations

1. **Decide if this is a vision doc or implementation spec** — and either split it or flesh it out accordingly
2. **Design system doc updates as a reviewable workflow**, not an automatic side effect of archiving
3. **Specify the spec→project transition** step by step
4. **Give task groups an explicit state machine** with failure handling
5. **Address write-path concerns** (atomicity, concurrency, ID generation)
6. **Show concrete memory schemas** and define the promotion mechanism
7. **Pick a storage location for repo memories** and trace cross-workspace access
8. **Define archival triggers and mechanics**
9. **State collaboration assumptions** (single-user-first is fine, just be explicit)
10. **Add error recovery section** for the main failure modes
