# Engy: Workspace Model

## The Problem

Software projects need two things that pull in opposite directions: a **permanent home** for ongoing concerns (a codebase, a product, a team's accumulated knowledge) and **ephemeral scopes** for bounded pieces of work (a feature, a refactor, a bug fix). Most tools force one entity to do both, and it's bad at both.

Concrete friction this creates:

Work often spans multiple repositories, but organizational entities typically bind to a single directory. There's no way to represent multi-repo topology. Worktrees and branches accumulate with no lifecycle management — there's no concept of "this work is done, clean up." Planning documents (specs, research notes) need a home that isn't tied to an execution scope, but there's nowhere to put pre-project thinking. Everything lives in a permanent flat structure, so you can't distinguish active initiatives from stalled work from completed efforts. There's no dashboard of what's in flight. Organizational entities accumulate stale tasks, outdated docs, and scope creep indefinitely because they have no natural "done" state. And after work completes, specs go stale and code becomes the only truth. No living document describes what the system actually *is* right now.

Beyond the data model problems, there's a workflow problem: engineers bounce between their IDE, terminal, GitHub, project management tools, and documentation sites. Context scatters across tools. AI-assisted workflows make this worse — agent output lands in one place, review happens in another, and feedback requires manually bridging the gap.

## Assumptions and Scope

This vision targets a **single-user, AI-assisted workflow** — one developer working with AI agents on their own codebases. The architecture is designed for this context.

Engy is the **single environment** for the entire development lifecycle. An engineer should never need to leave the app from idea through spec through implementation through review. The app provides the visual layer (dashboard, diff viewer, spec browser) and an embedded AI terminal provides the action layer — available on every page, powering every stage of the workflow.

Multi-user collaboration is a future concern. The git-backed knowledge layer makes it *possible* (push/pull, branching), but the vision doesn't address concurrent writes, access control, or conflict resolution between users. When that time comes, the architecture should support it without a rewrite, but it's not a design constraint today.

## Spec-Driven Development

Engy embraces spec-driven development (SDD) — the paradigm where specs are the primary artifact, driving AI agent implementation. The core loop: **Specify → Plan → Tasks → Implement**.

Engy extends SDD with two things most SDD tools lack:

**Memory and learning.** The system learns from past implementations and feeds that back into future planning. Most SDD tools are stateless — every project starts from zero context.

**Lifecycle and disposal.** Specs don't drift because projects are short-lived. The spec drives a bounded piece of work, the project completes, its valuable outputs get extracted (memory promotions, system doc updates), and the project is deleted. No long-lived project to maintain, no graveyard of archived tasks. The outcomes survive; the process doesn't.

---

## Interaction Model

Engy has two interaction surfaces that work together on every page of the app:

### The Terminal Panel (Claude Code)

The right side of the app hosts an embedded Claude Code terminal. This is the primary way users *do things* in Engy. It's not a secondary feature or a power-user escape hatch — it's the action layer for the entire workflow.

The terminal is **context-aware**. It knows what page you're on, what project is active, what task is selected. When you're viewing a spec, the terminal has that spec's context loaded. When you're in a project, it has the project's tasks and plan. When you're reviewing diffs, it has the diff context. The terminal adapts to wherever you are in the app.

Every stage of the SDD loop is driven through the terminal via **Claude Code skills**:

- **Spec authoring:** "Help me write a spec for auth revamp" — the skill reads system docs and workspace memories for context, asks clarifying questions, drafts the spec and context files, iterates with you until it's right.
- **Planning:** "Plan this spec" — the skill reads the spec + context, proposes milestones/groups/tasks, you iterate in the terminal, the plan materializes in SQLite.
- **Execution monitoring:** The terminal shows what the agent is doing during task execution. You can intervene, redirect, ask questions mid-execution.
- **Review feedback:** When reviewing diffs, you can give feedback directly in the terminal and it routes to the right agent session.
- **System doc updates:** "Update system docs for this project" — the skill reads completed tasks and proposes diffs.
- **Memory management:** "What do we know about auth?" — the skill searches workspace and repo memories, surfaces relevant context.
- **Ad-hoc work:** Quick bugs, one-off tasks, questions about the codebase — the terminal handles ambient work that doesn't warrant a project.

The terminal is always available. You're never forced into a form or wizard. The app's visual UI shows you the *state* of things (dashboard, spec browser, task board, diff viewer). The terminal is how you *change* things.

### The Diff Viewer

The diff viewer is Engy's review and commit interface. **All code changes flow through it.** It replaces the workflow of switching to a terminal for `git diff`, switching to GitHub for PR review, switching back for revisions.

The diff viewer shows:

- File-level diffs with syntax highlighting
- Line-level commenting
- Commit controls (stage, commit, push)

**The critical feature: feedback routing.** Every diff is produced by an agent session working on a specific task group. When you comment on a line in the diff viewer, that feedback goes directly back to the agent session that made the change — with full context of which file, which line, and what you said. The agent can then revise its work in the same worktree, and you see the updated diff.

This creates a tight review loop:

```text
Agent completes task → diff appears in viewer
  → you review, comment on line 42: "this should use the cached value"
  → feedback routes to the agent session (with file, line, and comment context)
  → agent revises in the same worktree
  → updated diff appears
  → you approve → commit through the diff viewer
```

The diff viewer is used for **all** commits, not just agent-produced code. If you make manual changes in a worktree, they show up in the diff viewer too. It's the single commit interface.

**Diff viewer for system doc updates:** When a project completes and system doc updates are proposed, they appear in the diff viewer as diffs against the current system doc files. You review them the same way you review code — comment, request changes, approve. Same interface, same muscle memory.

### How They Work Together

The app layout on any page:

```text
┌─────────────────────────────────┬──────────────────────┐
│                                 │                      │
│   Main Content Area             │   Terminal Panel     │
│   (dashboard / spec browser /   │   (Claude Code)      │
│    project view / diff viewer)  │                      │
│                                 │   Context-aware,     │
│                                 │   always available    │
│                                 │                      │
└─────────────────────────────────┴──────────────────────┘
```

The main content area changes based on where you are. The terminal persists. Context flows from the main area to the terminal automatically — if you click on a spec, the terminal knows you're looking at that spec. If you click on a task, the terminal has that task's context.

The diff viewer occupies the main content area when reviewing changes. The terminal stays open beside it for feedback that needs more nuance than a line comment — "rethink this whole approach" or "can you explain why you did it this way?"

---

## Core Concepts

### Workspace (the permanent home)

A **Workspace** is a permanent entity representing an ongoing concern — a codebase, a team, a product. It defines the topology (which repos), holds shared knowledge, and contains ephemeral projects.

The workspace itself acts as the template for project creation — no separate template entity needed. When you create a project, it inherits the workspace's repos, conventions, shared docs, and memory automatically.

A workspace owns:

- **Repos** — The git repositories in scope (multiple allowed). These are defaults, not a hard boundary — projects can reference repos outside the workspace when needed.
- **System docs** — The canonical, always-current description of what the system IS right now. Updated through a review workflow when projects complete.
- **Shared docs** — Coding conventions, style guides, runbooks. Organizational knowledge true across all projects.
- **Specs** — Pre-project thinking spaces with supporting context. The input that drives projects.
- **Memory** — Workspace-level persistent knowledge (patterns, learnings, conventions).
- **Unscoped tasks** — Ambient work that doesn't belong to a specific project (quick bugs, one-off tasks). These live in SQLite alongside project tasks, just without a project reference.
- **Projects** — Ephemeral execution scopes (see below).

### System Docs (the living source of truth)

The `system/` directory is the canonical description of what the system actually is *right now*. Not aspirational, not a spec — factual. It's the output of completed work, not the input.

```text
.engy/
  system/
    overview.md               # high-level architecture
    authentication.md         # "Auth uses JWT, refresh tokens rotate on use..."
    task-management.md
    api.md
    database.md
    deployment.md
```

Each file is the canonical truth for that domain. The directory structure IS the context scoping — an agent working on an auth spec reads `system/authentication.md` and maybe `system/api.md`, not the whole system.

**The feedback loop:**

```text
System Doc (current state)
  ↓ (agent reads for context — via terminal skill)
Spec (proposed change)
  ↓ (approved)
Project (execution — lives in SQLite)
  ↓ (completed)
System Doc Update Review  ← proposed diff in the diff viewer
  ↓ (approved via diff viewer)
System Doc (updated)
  ↓
Project deleted from database  ← outcomes extracted, process discarded
```

System docs are both the output of past work and the context for future work. The critical difference from a naive approach: **system doc updates are a reviewable step, not an automatic side effect of project completion.**

#### System Doc Update Workflow

When a project completes, a Claude Code skill reads the completed tasks, the plan, the decisions made, and proposes patches to the relevant system doc files. These patches appear in the diff viewer — the same interface used for code review. You review the proposed changes, comment on inaccuracies, and the skill revises until the update is right.

Why this matters: if an agent writes a slightly inaccurate system doc update and future specs are written against that inaccurate context, errors compound. The review step is the quality gate that prevents drift.

**Taxonomy evolution:** System doc files are created manually or proposed by the skill when a project introduces a genuinely new domain. An agent completing work that doesn't fit any existing system doc file can propose a new file as part of the update review. The user approves the new file along with the content — all in the diff viewer.

**Conflict handling:** System doc updates are applied sequentially. If two projects complete around the same time, the second update is generated against the already-updated system docs (including the first project's changes). This is a natural consequence of the review workflow — you review and merge one at a time, like PRs to main.

### Specs (pre-project thinking spaces)

Specs live at the workspace level, not inside projects. A spec is a directory containing the spec document plus all supporting research and context:

```text
.engy/
  specs/
    auth-revamp/
      spec.md
      context/
        current-auth-flow.md
        competitor-research.md
        performance-benchmarks.png
        slack-thread-notes.md
```

The spec directory is self-contained — everything an agent needs to understand the proposed change lives here, including supporting research, benchmarks, and notes.

#### Vision Specs (foundational references)

Not every spec becomes a project. A **vision spec** is a foundational document that captures the big-picture design for a system or major initiative. It's too large to execute as a single project — instead, it serves as the shared reference that child specs are carved from.

A vision spec lives in `specs/` like any other spec (e.g., `specs/initial/`), but its lifecycle is different: **Draft → Completed**. It skips the Approved → Active → Project path entirely. It never becomes a project. It's the parent context that keeps child specs coherent with each other.

```text
specs/
  initial/                          ← vision spec, never becomes a project
    spec.md                         ← the foundational design
    context/
      brainstorm.md
      review.md
  1_storage-layer/                  ← child spec, carved from initial/, becomes a project
    spec.md                         ← references initial/ for context
    context/
      ...
  2_workspace-project-model/        ← child spec, carved from initial/, becomes a project
    spec.md                         ← references initial/ for context
    context/
      ...
```

The numerical prefix establishes build order — earlier specs can't depend on later ones. The filesystem sorts them naturally. Vision specs like `initial/` have no number because they don't participate in the build sequence.

Child specs reference the vision for context but scope themselves to one buildable chunk. Each child becomes one project. The vision stays frozen as a historical artifact — the system docs that evolve from completed projects become the living truth, and the vision becomes the record of original intent.

**Spec authoring** happens through the terminal. You open the spec browser (or start from the dashboard), and use the Claude Code spec-writing skill. The skill reads system docs and workspace memories for context, helps you research and draft, creates the spec file and context directory, and iterates with you until the spec is ready. The spec browser in the main content area shows you the rendered result as you work.

**Spec lifecycle (buildable specs):**

```text
Draft → Ready → Approved → Active (project exists) → Completed
```

- **Draft:** Under active research and writing via the terminal. Mutable.
- **Ready:** Author considers it complete, ready for review.
- **Approved:** Reviewed and approved. Ready to become a project.
- **Active:** A project has been created from this spec. The spec freezes — it becomes a historical record of intent. Changes to scope during execution are captured in plan content within the project, not by editing the spec.
- **Completed:** The project completed and was deleted. The spec remains as the permanent record of what was intended. This is one of the few artifacts that survives a project — the others being promoted memories and system doc updates.

**Spec lifecycle (vision specs):**

```text
Draft → Completed
```

Vision specs skip the project path. They're completed when the child specs have been carved from them and the vision has served its purpose as the foundational reference.

Spec status is tracked in frontmatter within `spec.md` itself, keeping it self-contained with the rest of the spec's file-based content.

#### Spec → Project Transition

When a spec is approved and the user triggers project creation (via the terminal or a UI action):

1. **A project record is created in SQLite** using the spec's slug as its identifier. The spec `auth-revamp` becomes project `auth-revamp`. The project references the spec by its directory path — no explicit slug field needed, since the naming convention IS the link.
2. **Planning begins.** A Claude Code planning skill decomposes the spec into milestones, task groups, and tasks. This is iterative — the skill proposes a decomposition in the terminal, you review and adjust, the skill refines. All of this lives in SQLite. The project view in the main content area shows the plan taking shape as you iterate.
3. **The spec's status updates** to Active (written to `spec.md` frontmatter).

**One spec, one project** is the default. If a spec is too large for one project, the right move is to split the spec first (into `auth-revamp-phase-1/` and `auth-revamp-phase-2/`), then create a project from each. This keeps the 1:1 mapping clean and specs appropriately scoped.

### Project (the ephemeral execution scope)

A **Project** is a scoped unit of work with a lifecycle. It represents a single initiative, feature, or effort. **Projects live entirely in SQLite** — they are execution state, not knowledge. When a project completes, its valuable outputs are extracted (memories promoted to files, system docs updated) and the project is deleted.

A project contains:

- **Milestones** — Large chunks of work within the project.
- **Tasks** — Concrete work items, organized under milestones.
- **Task Groups** — Tasks sharing a `groupId` ship together as one PR, share a worktree/branch.
- **Plan content** — The implementation plan created during the planning phase. Stored as structured data in SQLite, not as separate files.
- **Agent sessions** — Persistent, resumable sessions tied to task groups (see below).
- **Project-scoped memory** — Decisions, context, and learnings specific to this effort. Also in SQLite. Valuable memories get promoted to file-based workspace memory on completion.

**Project lifecycle:**

```text
Planning → Active → Completing → Deleted
```

- **Planning:** Milestones, groups, and tasks are being defined via the terminal. Nothing is executing yet.
- **Active:** Task groups are being picked up and executed. Worktrees are created lazily. Diffs flow to the diff viewer.
- **Completing:** All tasks are done or explicitly dropped. Completion process is running: memory distillation, system doc update proposal (in diff viewer), worktree cleanup.
- **Deleted:** Gone. The project's valuable outputs — promoted memories (now files in `.engy/memory/`), system doc updates (now in `.engy/system/`), and merged PRs (now in git) — survive. The project itself, its tasks, its execution history, are discarded. The spec that started it remains in `.engy/specs/` as the permanent record of intent.

This is the key insight: **a project is a process, not an artifact.** It runs, produces outcomes, and is discarded. Keeping dead task records around "just in case" is hoarding — if the outcomes were properly extracted, the execution history is noise.

### Agent Sessions

An **Agent Session** is a persistent, resumable Claude Code session tied to a task group. It's the execution context for AI-driven work.

When a task group becomes Active, an agent session is created (or resumed if one already exists for that group). The session has:

- **Full context:** The spec, the plan, the task descriptions, workspace memories, repo memories, system docs — everything the agent needs.
- **Worktree access:** The session operates in the task group's worktree(s).
- **Identity:** A stable session ID that the diff viewer uses to route feedback back.
- **Continuity:** If the agent crashes, the session can be resumed with its full prior context. If the user gives feedback via the diff viewer, it arrives in the same session that produced the code.

The session lifecycle mirrors the task group:

```text
Task group becomes Active → session created/resumed
  → agent executes tasks sequentially
  → produces diffs (visible in diff viewer)
  → receives feedback from diff viewer comments
  → revises and re-produces diffs
  → user approves and commits via diff viewer
Task group moves to Review/Merged → session becomes inactive
Task group cleaned up → session data discarded
```

**Why sessions matter:** Without persistent sessions, feedback is disconnected. You'd comment on a diff, and a *new* agent instance would try to interpret your feedback without the context of why it made the original decision. With persistent sessions, the agent that receives your "this should use the cached value" comment is the same agent that chose not to use the cached value — it knows *why* it made that choice and can either explain its reasoning or make an informed revision.

Sessions are stored in SQLite as part of the project. They're deleted when the project is deleted — they're execution state, not knowledge.

### Task Groups (the shippable unit)

A **Task Group** is a set of tasks that ship together as one PR. It's the unit of worktrees, branches, agent sessions, and parallelization. Task groups live in SQLite as part of the project.

Why this granularity:

- **Not per-project** — Projects can be long-lived (relatively). One worktree per project across 3 repos × 3 projects = 9 worktrees before writing any code.
- **Not per-task** — Too much churn. Sequential tasks need to see each other's changes. One task = one PR is too granular.
- **Per task group** — Maps to a PR. Tasks within a group see each other's commits. Worktree lifecycle matches the shippable unit. One agent session per group.

**Task group lifecycle:**

```text
Planned → Active → Review → Merged → Cleaned Up
```

- **Planned:** Group exists in the plan. No worktree yet. Tasks are defined but not started.
- **Active:** Worktree created, branch created, agent session running. Tasks execute sequentially within the session. Diffs appear in the diff viewer as work progresses.
- **Review:** All tasks in the group are complete. Diffs are in the diff viewer awaiting review. The user reviews, comments (feedback routes to the agent session), agent revises, user approves, commits through the diff viewer.
- **Merged:** Committed and pushed. Work is in the target branch. PR created on remote if applicable.
- **Cleaned Up:** Worktree deleted, branch cleaned up (if merged). Agent session discarded. Terminal state.

**Failure handling:**

- If a task within a group fails validation, the group blocks. The failing task must be resolved (fixed or dropped) before the group can proceed — feedback through the diff viewer or terminal. You don't ship partial groups — the whole point of a group is that it's a coherent unit.
- If a task is dropped from an active group, the worktree continues with the remaining tasks. If all tasks are dropped, the group moves to Cleaned Up (no PR).
- If a commit has merge conflicts, the group stays in Review. Conflicts are resolved in the worktree (via the terminal) before committing.

**Cross-repo groups:** A group that touches multiple repos creates one worktree per repo and produces diffs in each. The diff viewer shows all diffs for the group together. The group isn't "done" until all repos are committed and pushed. Commits are coordinated — they should land together.

**Creation:** Task groups are created during the planning phase via the terminal. The planning skill proposes the grouping based on which tasks are logically coupled (shared branch, coherent PR). The user can adjust groupings in the terminal or via the project view UI. Groups can be reorganized before a group becomes Active — once work starts, the group is locked.

### Milestones

A **Milestone** is an organizational grouping of task groups within a project. It represents a meaningful checkpoint — "backend auth is done," "frontend is wired up."

A milestone is complete when all its task groups are in Merged or Cleaned Up state. Milestones can run in parallel when they're independent (no cross-milestone task dependencies).

Milestone completion drives the dashboard progress indicators.

---

## Storage Architecture

### Knowledge in Files, Execution in Database

The fundamental split: **things that accumulate lasting value are files (git-tracked). Things that are transient execution state live in SQLite.**

```text
FILES (.engy/, git-tracked — permanent knowledge)
  ├── workspace.yaml          # repos, config
  ├── system/                 # what the system IS right now
  ├── specs/                  # what was proposed (frozen after project creation)
  ├── docs/                   # conventions, guides, org knowledge
  └── memory/                 # promoted workspace + repo memories

SQLite (ephemeral execution state)
  ├── projects                # active projects
  ├── milestones              # project milestones
  ├── task_groups             # shippable units
  ├── tasks                   # work items (scoped + unscoped)
  ├── agent_sessions          # persistent session context per task group
  ├── fleeting_memories       # agent working notes
  ├── project_memories        # project-scoped decisions
  └── plan_content            # implementation plans

ChromaDB (vector search index)
  └── everything embedded — files + active DB content
```

**Why this split works:**

Files hold **knowledge** — things that have lasting value, need versioning, and should survive project deletion. System docs describe the current state of the codebase. Specs capture intent. Promoted memories capture learnings. These benefit from git (versioning, backup, portability, collaboration).

SQLite holds **execution state** — things that are transient by nature. Tasks, milestones, agent sessions, and project records are process bookkeeping. They exist to coordinate work. Once the work is done and outcomes extracted, this data has served its purpose. It doesn't need versioning, backup, or portability — it needs fast reads, fast writes, and relational queries.

**What this eliminates:**

- No directory-per-project with dozens of task files
- No moving directory trees on archive
- No file I/O for every task status change (Todo → In Progress is a DB update, not a file write)
- No write-path atomicity concerns for task operations (SQLite gives you transactions)
- No ID generation race conditions (SQLite auto-increment)
- No `engy reindex` needed for execution state — the database IS the state
- No archived project directories accumulating forever

**What `engy reindex` still does:** Rebuilds ChromaDB's vector index from files + current database content. Also validates file-based content (system docs, specs, memories). But it no longer needs to parse hundreds of task files — those don't exist as files.

### File-Based Entities

**System docs** (`system/*.md`) — Markdown files. The canonical description of the current system. Updated through the diff viewer when projects complete.

**Specs** (`specs/{slug}/`) — Directories containing `spec.md` plus a `context/` subdirectory with supporting research. Self-contained. Status tracked in `spec.md` frontmatter. Authored via the terminal.

**Shared docs** (`docs/*.md`) — Markdown files. Conventions, style guides, org knowledge.

**Permanent memories** (`memory/*.md`) — Markdown files with YAML frontmatter. The distilled learnings that survive project deletion. (Schema below.)

### Database Entities

**Projects** — Name/slug, status, timestamps, spec reference. Created when a spec is approved. Deleted when completion process finishes.

**Milestones** — Title, project reference, status, ordering.

**Task Groups** — Group name, milestone reference, status (Planned → Active → Review → Merged → Cleaned Up), repos list.

**Tasks** — Title, description, status, milestone reference, group reference, dependencies, importance/urgency. Project reference is nullable — null means unscoped workspace task.

**Agent Sessions** — Session ID, task group reference, session state/context, status (active/inactive/discarded). The persistent context that enables feedback routing from the diff viewer.

**Fleeting memories** — Lightweight notes from agents during execution. Most are discarded during synthesis; valuable ones promote to permanent file-based memories.

**Project memories** — Decisions and context specific to a project. Evaluated for promotion during project completion. Valuable ones become permanent memory files; the rest are deleted with the project.

**Plan content** — Implementation strategy, decomposition rationale, key technical decisions. Referenced by tasks for broader context.

### ChromaDB as Universal Search

ChromaDB indexes all text content across both layers — file-based system docs, specs, memories AND active database content (tasks, project memories, plans). This enables:

- **Spec writing:** "Show me everything we know about auth" — searches system docs, memories, and any active project content via the terminal.
- **Task decomposition:** RAG over spec context + system docs + workspace memories + similar past work.
- **Cross-content discovery:** Find connections between a spec and existing memories, or between a task description and system doc content.

Note: since projects are deleted on completion, ChromaDB does *not* retain historical task data. The lasting knowledge is captured in promoted memories and system docs, which are always indexed. The execution detail is gone — by design.

---

## Memory Architecture

Memory is structured knowledge that accumulates as work happens. It's the mechanism by which Engy learns from past implementations and feeds that back into future planning.

### Permanent Memory Schema (files)

Permanent memories are the distilled output of project work — the learnings worth keeping. They live as markdown files in `.engy/memory/`:

```text
.engy/memory/M500-jwt-rotation-pattern.md
```

```markdown
---
id: M500
type: permanent
subtype: pattern
title: JWT rotation with grace period
scope: workspace
repo: engy-api
confidence: 0.9
source: auth-revamp
tags: [auth, jwt, tokens]
linkedMemories: [M480, M495]
createdAt: 2026-02-15T10:30:00Z
---

When implementing JWT refresh token rotation, always include a grace period
(default 30s) for the old token. Without this, concurrent requests from the
same client will fail because the first request rotates the token and
invalidates it for subsequent in-flight requests.

Learned during auth-revamp project when integration tests revealed race
conditions in the refresh flow.
```

### Memory Types

**Permanent memories** (files) are curated, high-confidence knowledge:

| Subtype      | Purpose                                            | Example                                        |
|------------- |--------------------------------------------------- |------------------------------------------------|
| `decision`   | Why something was done a certain way               | "Chose Argon2 over bcrypt for password hashing because..." |
| `pattern`    | Reusable approach that worked                      | "JWT rotation needs a grace period"            |
| `fact`       | Verified truth about the system                    | "The API rate limit is 100 req/min per user"   |
| `convention` | Team/project convention                            | "All API errors return {code, message, details}" |
| `insight`    | Higher-order observation                           | "Auth changes always cascade to 3+ services"   |

**Fleeting memories** (SQLite) are lightweight working notes emitted by agents during execution. They're fast to create, triaged later. Most are discarded; valuable ones promote to permanent files.

**Project memories** (SQLite) are decisions and context specific to one project. They live as long as the project does. On project completion, valuable ones are promoted to permanent memory files; the rest are deleted with the project.

### Memory Scoping

Permanent memories have two scopes:

**Workspace memory** (`scope: workspace`) — Cross-project learnings, organizational decisions, preferences. Available to all projects in the workspace. No `repo` field.

**Repo memory** (`scope: repo`) — Patterns, conventions, and architectural knowledge about a specific repository. Has a `repo` field that scopes it. When an agent works on a task touching `engy-api`, it queries for memories where `repo: engy-api`.

The repo field is the **universal join key**. In the single-workspace model, all memories are in `.engy/memory/`. For future multi-workspace scenarios, repo memories could be stored in the repo itself or cross-workspace search could query multiple workspace directories.

### Memory Lifecycle

**During execution:** Agents emit fleeting memories into SQLite (fast writes, no file I/O). A synthesis step triages fleeting memories against existing permanent memories at task group boundaries. Novel insights promote to permanent memory files immediately. Redundant or hyper-specific captures are discarded or left as fleeting notes for end-of-project review.

**On project completion — memory distillation:**

1. **Project memories are evaluated** for promotion. The synthesis step reads all project memories, compares against existing workspace/repo memories, and decides what's novel and worth keeping.
2. **Valuable learnings promote** — written as new files in `.engy/memory/` with appropriate scope (workspace or repo).
3. **Deduplication:** If a similar memory already exists as a file, the existing one is updated (strengthened confidence, added context) rather than creating a duplicate.
4. **Everything else is deleted** with the project. The fleeting notes, the project-specific decisions that don't generalize, the execution minutiae — gone.

### Context Injection for Agents

When an agent session executes a task, it receives memories in this order (most specific first):

1. **Project memories** — decisions and context for the current project (from SQLite)
2. **Workspace memories** — cross-project patterns and conventions (from files)
3. **Repo memories** — patterns for each repo the task touches (from files, filtered by `repo` field)

When planning a new project (via the terminal), the agent sees: system docs + workspace memories + repo memories (all files). No historical project data — the lasting knowledge has already been distilled into memories and system docs.

---

## Worktree Strategy

Worktrees are tied to **task groups** — the shippable unit of work (a set of tasks that become one PR).

```text
Pick up Task Group A (T150, T151, T152) in Milestone 1
  → group knows it touches engy-api
  → create worktree: engy-api/worktrees/auth-revamp-token-refresh
  → create branch: auth-revamp/token-refresh
  → agent session executes tasks sequentially in the worktree
  → each task produces commits (visible in diff viewer)
  → user reviews diffs, provides feedback → routes to agent session
  → agent revises → user approves → commits via diff viewer
  → group complete → worktree cleaned up
```

**Multi-repo task groups:**

```text
Task Group: "Wire refresh flow e2e"
  repos: [engy-api, engy-app]
  → worktree in each repo
  → agent session works across both
  → diffs from both repos appear together in diff viewer
  → group completes → commits in each repo, coordinated
  → all pushed → all worktrees cleaned up
```

The workspace defines which repos are available by default. The task group declares which repos it touches — including repos outside the workspace when needed. Worktrees are lazy: spun up when a group becomes Active, torn down when it reaches Cleaned Up.

### Branch Naming

Derived from project slug + group name:

```text
auth-revamp/token-refresh
auth-revamp/frontend-auth-hook
ci-overhaul/pipeline-migration
```

---

## Workflow: The Full SDD Loop

```text
SYSTEM DOC (current state) + WORKSPACE MEMORY (files)
  ↓
  │  Terminal: spec-writing skill reads context
  ↓
SPEC (proposed change, with context/ dir — files)
  ↓
  │  Terminal: user approves, triggers project creation
  ↓
PROJECT (created in SQLite from spec)
  ↓
  │  Terminal: planning skill decomposes into milestones → groups → tasks
  │  User reviews/adjusts in terminal + project view
  ↓
EXECUTE (runner picks up task groups)
  ↓
  ├── agent sessions activate per task group
  ├── tasks execute sequentially within sessions
  ├── diffs flow to diff viewer as work progresses
  ├── user reviews diffs, comments route to agent sessions
  ├── agents revise, user approves, commits via diff viewer
  ├── fleeting memories accumulate in SQLite
  ↓
COMPLETE
  ├── all milestones done (or remaining work explicitly dropped)
  ├── memory distillation runs → valuable memories written to .engy/memory/
  ├── system doc update proposed → appears in diff viewer for review
  ├── user reviews and approves system doc diffs
  ├── spec status updated to Completed
  ├── worktrees cleaned up, agent sessions discarded
  └── project deleted from SQLite  ← outcomes extracted, process discarded
```

### Parallelization

Task groups on independent repos can run in parallel — separate worktrees, separate agent sessions, no conflicts. The dependency graph is partially repo-aware:

```text
[engy-api] Group: "Add endpoints" ──┐
                                      ├── [engy-api, engy-app] Group: "Wire e2e"
[engy-app] Group: "Add auth hooks" ──┘
```

Milestones can also parallelize when independent (no cross-milestone task dependencies).

---

## Error Recovery and Failure Modes

### Agent Crash Mid-Execution

If an agent crashes during task group execution, the worktree is left in whatever state it was in. The agent session persists in SQLite — it can be resumed with its full prior context. On restart, the runner detects the Active group with no running agent and offers to resume the session. The worktree contains the commits from completed tasks within the group — only the in-progress task needs to restart. Git's durability means committed work is safe; uncommitted changes may be lost.

### Database Loss

If SQLite is lost, active projects and their tasks are gone — including agent sessions. This is acceptable because:

- **Completed projects were already deleted.** There's nothing to lose from past work — its value was extracted into files.
- **Active projects are recoverable from context.** The spec is still in `.engy/specs/`. The merged PRs are in git. The promoted memories are in `.engy/memory/`. The worst case is re-creating the project and re-planning from the spec — annoying but not catastrophic.
- **Standard SQLite backup strategies apply.** WAL mode, periodic `.backup`, etc. The point isn't that we don't care about the database — it's that losing it isn't existential.

For extra safety, SQLite can be configured to live inside `.engy/` (e.g., `.engy/engy.db`) and get committed to git periodically. This is optional — it's a convenience backup, not a source-of-truth claim.

### Bad System Doc Update

If a system doc update introduces inaccuracies (caught after the fact), the fix is a direct edit to the system doc file — through the terminal or directly. Since system docs are git-tracked, you can also `git revert` the specific commit if the update was isolated. The diff viewer review workflow is the primary defense — catching bad updates before they land.

### Corrupted Memory Files

`engy validate` checks memory file frontmatter for schema compliance, broken linked-memory references, and duplicate IDs. Malformed files are logged as warnings and skipped during ChromaDB indexing. The system never fails hard on bad input.

### ChromaDB Corruption

ChromaDB is always rebuildable — reindex from files + current SQLite content. Delete the ChromaDB data directory, run reindex, everything rebuilds including embeddings. Slower than SQLite recovery but fully automated.

---

## Validation and Tooling

`engy validate` performs comprehensive health checks on the file layer:

- **Broken links:** Walks all frontmatter references (`linkedMemories`, spec cross-references) and verifies targets exist.
- **Schema compliance:** Validates frontmatter against expected schemas (memories require `id`, `type`, `scope`, `subtype`; specs require status field; etc.).
- **Duplicate IDs:** Detects multiple memory files claiming the same ID.
- **Orphaned content:** Finds memories referencing projects that no longer exist in SQLite (expected for promoted memories — just a check that the `source` field is informational, not a live reference).
- **Lifecycle consistency:** Flags specs in Active state with no corresponding project in SQLite, or specs in Completed state whose system doc updates haven't landed.

`engy reindex` rebuilds ChromaDB from files + SQLite content. Safe to run anytime.

Both commands are available as Claude Code skills in the terminal.

---

## Active Work Dashboard

With ephemeral projects, tracking active work becomes natural:

```text
Workspace: engy
  Active Projects:
    auth-revamp     ██████░░░░ 60%  (3/5 milestones)
    ci-overhaul     ██░░░░░░░░ 20%  (1/5 milestones)
    plan-mode       █████████░ 90%  (4/5 milestones)

  Specs in Progress: 2
  Unscoped Tasks: 5
```

Progress is derived from milestones. A milestone is complete when all its task groups have reached Merged or Cleaned Up state. Project progress = completed milestones / total milestones.

At a glance: what's in flight, what's stalled, what's done. No "Archived: 147 projects" clutter — completed projects are gone. Their value lives in the system docs and memories. WIP limits become visible — if three projects are active and none are progressing, that's a signal to focus.

Clicking into any project from the dashboard opens the project view with the terminal already contextualized — ready to work.

---

## Cross-Workspace Work

Workspace boundaries are **organizational, not technical**. A task group can touch any repo on disk — the workspace just defines the default set.

### Small Coordinated Changes

A project's task can reference repos from other workspaces directly. The worktree gets created in whatever repo, regardless of which workspace "owns" it.

### Substantial Cross-Workspace Efforts

If changes are large enough to warrant it, create a project in each workspace and track the dependency between them. Two projects, two workspaces, coordinated at the human level.

### Memory Follows the Repo

When a project touches a repo, the agent session automatically gets repo-scoped memories for that repo — patterns, conventions, past learnings — because memory lookup includes the `repo` field.

```text
Agent session working on T160 (touches shared-lib)
  → project memories (from SQLite — current project context)
  → workspace memories (from files — cross-project learnings)
  → repo memories for shared-lib (from files — repo-specific patterns)
```

The repo is the universal join key across workspace boundaries. Workspaces organize *your work*. Repos organize *knowledge about code*. They're orthogonal.

### Cross-Workspace Context for Specs

For spec research that needs docs from another workspace: copy the relevant material into the spec's `context/` dir (the terminal skill can help with this). The copy lives with the spec, is self-contained, and doesn't break when the source changes. ChromaDB can still search across all content for discovery, but the actual reference is a local copy.

---

## Filesystem Structure

The file layer is lean — only permanent knowledge:

```text
.engy/
  workspace.yaml              # repos, config, workspace metadata
  system/                     # living source of truth (current state)
    overview.md
    authentication.md
    task-management.md
    api.md
    database.md
    deployment.md
  specs/                      # pre-project thinking (proposed changes)
    initial/                  # vision spec — foundational reference, never becomes a project
      spec.md
      context/
        brainstorm.md
        review.md
    1_storage-layer/          # status: Active (project exists in SQLite)
      spec.md                 # references initial/ for context
      context/
        ...
    2_workspace-model/        # status: Draft
      spec.md                 # references initial/ for context
      context/
        ...
    3_interaction-model/      # status: Draft
      spec.md                 # references initial/ for context
      context/
        ...
  docs/                       # org knowledge (conventions, guides)
    coding-conventions.md
    api-style-guide.md
  memory/                     # promoted workspace + repo memories
    M500-jwt-rotation-pattern.md
    M501-api-error-convention.md
    M502-shared-lib-testing-pattern.md
```

That's it. No project directories. No task files. No archived project trees. The execution layer lives in SQLite, does its job, and gets cleaned up. The knowledge layer in `.engy/` stays small, focused, and meaningful.

---

## Known Tradeoffs and Open Questions

**Short-lived project assumption.** The model works best with projects that complete in days to weeks. A project that drags on for months accumulates state in SQLite that can't be extracted until completion. The mitigation is cultural: scope projects tightly, split large efforts into phases, complete aggressively.

**No project history.** Once a project is deleted, you can't go back and look at its tasks, execution order, or detailed decisions. The bet is that this detail is noise — the valuable signal was extracted into memories and system docs. If you disagree, you'll want a different model. Specs survive as the permanent record of intent; merged PRs in git are the permanent record of implementation; memories capture the learnings. The execution choreography is disposable.

**System doc update quality.** Even with a review workflow in the diff viewer, system doc updates are only as good as the reviewing agent or human. The review step prevents obviously bad updates, but subtle inaccuracies can still slip through. Over time, system docs may need periodic full audits independent of project completion.

**Memory promotion quality.** Automated distillation may promote noise or miss valuable insights. The synthesis step should err on the side of keeping less (high precision, lower recall) — it's better to miss a useful memory than to pollute the workspace memory with noise. Users can always manually promote memories via the terminal.

**Database as single point of failure for active work.** Active projects exist only in SQLite. Standard database reliability practices apply (WAL mode, backups). Loss of the database loses active project state — but not completed work, which has already been extracted to files and git. Optionally, the SQLite file can live inside `.engy/` and be periodically committed for backup.

**Repo memory in multi-workspace future.** The current design stores repo memories in `.engy/memory/` with a `repo` field. This works for single-workspace. For multi-workspace, the question of where repo memories canonically live needs revisiting.

**Unscoped task lifecycle.** Unscoped tasks (quick bugs, one-off work) live in SQLite without a project. They don't go through the full project lifecycle. How do they eventually get cleaned up? Manual deletion, or an age-based sweep, or just accept that the unscoped task list needs periodic grooming.

**ChromaDB rebuild cost.** Full reindex with embedding regeneration is the slowest recovery operation. Since it now only indexes files + current database content (not hundreds of archived task files), this should be significantly faster than a file-heavy architecture. But large memory collections with long content could still take time.

**Terminal skill boundaries.** The terminal powers the entire workflow, which means the quality of the experience depends heavily on the skills. Poorly designed skills create friction. The skill set needs to be comprehensive enough to cover the full SDD loop without forcing users to fall back to raw commands, but flexible enough that power users can drop to raw Claude Code when needed.
