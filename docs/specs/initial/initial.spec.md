# Engy 2.0: Workspace Model

## Problem

The current "project" entity in Engy is pulling double duty as both an organizational bucket and an execution scope, and it's bad at both. Real-world friction:

* **Multi-repo work** — Projects only link to one directory, but work often spans multiple repos. No way to represent this.

* **Worktree clutter** — Worktrees accumulate with no lifecycle management. The worktree dropdown fills up with stale entries because there's no concept of "this work is done, clean up."

* **Specs need a home** — Creating throwaway projects just to hold planning docs (specs, research notes) that don't belong to any specific execution scope. Then manually bridging to the "real" project for tracking.

* **No visibility into active work** — Everything lives in one permanent project. Can't distinguish active initiatives from stalled work from completed efforts. No dashboard of what's in flight.

* **Projects are permanent** — They accumulate stale tasks, outdated plan docs, and scope creep indefinitely. No natural "done" state.

* **No source of truth for current state** — After work completes, specs go stale and code is the only truth. No living document describes what the system actually IS right now.

## Spec-Driven Development

This model embraces spec-driven development (SDD) — the emerging paradigm where specs are the primary artifact, driving AI agent implementation. The core loop: **Specify → Plan → Tasks → Implement**.

Engy's workspace model extends SDD with two things most SDD tools lack:

1. **Memory and learning** — The system learns from past implementations and feeds that back into future planning. Most SDD tools are stateless.

2. **Lifecycle and archival** — Specs don't drift because projects are short-lived. The spec drives a bounded piece of work, the project archives, done. No long-lived spec to maintain.

## Core Concepts

### Workspace (replaces current Project)

A **Workspace** is a permanent entity representing an ongoing concern — a codebase, a team, a product. It defines the topology (which repos), holds shared knowledge, and contains ephemeral projects.

The workspace itself acts as the template for project creation — no separate template entity needed. When you create a project, it inherits the workspace's repos, conventions, shared docs, and memory automatically.

A workspace owns:

* **Repos** — The git repositories in scope (multiple allowed). These are defaults/suggestions, not a hard boundary — projects can reference repos outside the workspace.

* **System docs** — The canonical, always-current description of what the system IS right now. Updated automatically when projects complete.

* **Shared docs** — Coding conventions, style guides, runbooks. Organizational knowledge true across all projects.

* **Specs** — Pre-project thinking spaces with supporting context. The input that drives projects.

* **Memory** — Workspace-level persistent knowledge (patterns, learnings, conventions)

* **Unscoped tasks/docs** — Ambient work that doesn't belong to a specific project (quick bugs, one-off tasks)

* **Projects** — Ephemeral execution scopes (see below)

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

Each file is the canonical truth for that domain. Agent finishing auth work? Updates `system/authentication.md`. Not a monolith — just the relevant slice.

**The feedback loop:**

```text
System Doc (current state)
  ↓ (agent reads for context)
Spec (proposed change)
  ↓ (approved)
Project (execution)
  ↓ (completed)
System Doc (updated with changes)  ← delta, not rewrite
```

System docs are both the output of past work and the context for future work. When a project archives, an agent reads the completed tasks, the plan, the decisions made, and patches the relevant system doc files. This closes the loop that every other SDD tool leaves open.

**Context scoping for agents:** Working on an auth spec? Read `system/authentication.md` and maybe `system/api.md`. Don't need to load the whole system. The directory structure IS the context scoping.

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

When a spec is approved, it **becomes a project**. The project links back to the spec dir, so agents planning task decomposition can read not just the spec but all the supporting context. The slug carries through: `auth-revamp` as a spec dir → `auth-revamp` as a project.

**Lifecycle:** Idea → Spec (research, draft, iterate) → Approve → Project (execute) → Archive (frozen, queryable) → System Doc updated

No separate doc type system needed — a spec isn't a label on a doc, it's a directory in `.engy/specs/` with a lifecycle. The structure IS the type.

### Project (new, ephemeral)

A **Project** is a scoped unit of work with a lifecycle: create → plan → execute → archive. It represents a single initiative, feature, or effort.

A project has:

* **Milestones** — Large chunks of work within the project

* **Tasks** — Concrete work items, organized under milestones

* **Task Groups** — Tasks sharing a `groupId` ship together as one PR, share a worktree/branch

* **Plan docs** — Spec link, implementation plans (via `documentSlug` and `planSlug`)

* **Project-scoped memory** — Decisions, context specific to this effort (freezes on archive)

Projects are **short-lived by design**. When all work is done, the project archives — tasks freeze, memory distills, worktrees clean up, system docs update. Archived projects remain queryable but inactive.

### Shared Workspace Docs

Workspaces hold docs that are true across all projects but aren't system docs (which describe the system itself):

```text
.engy/
  docs/
    coding-conventions.md
    api-style-guide.md
    onboarding-guide.md
```

These are "org knowledge" — things an agent should always have access to regardless of which project it's executing in. Team conventions, recurring decisions.

## Storage Architecture

### Files as Source of Truth, Databases as Indexes

The `.engy/` directory is the single source of truth for everything. Databases are rebuildable indexes derived from files.

```text
.engy/ (git-tracked, source of truth)
  ├── workspace.yaml
  ├── system/
  ├── specs/
  ├── docs/
  ├── memory/
  └── projects/
       └── auth-revamp/
            └── tasks/
                 └── T150.md

SQLite   → relational index (rebuilt from .engy/ files)
ChromaDB → vector search index (rebuilt from .engy/ files)
```

`engy reindex` — Walks the `.engy/` directory, parses everything, rebuilds both databases from scratch. Clone the repo on a new machine, run reindex, you're working. No database migration, no backup strategy, no sync — git IS your backup.

**Three layers, each doing what it's good at:**

| Layer          | Role             | Content                                                         |
| -------------- | ---------------- | --------------------------------------------------------------- |
| `.engy/` files | Source of truth  | System docs, specs, tasks, memory, config                       |
| SQLite         | Relational index | Task relationships, groupIds, milestones, fast queries          |
| ChromaDB       | Vector search    | Everything embedded — universal search across all content types |

### Tasks as Flat Files

Tasks are markdown files with YAML frontmatter. Relationships are declared in frontmatter, SQLite rebuilds the graph on reindex.

```text
.engy/projects/auth-revamp/tasks/
  T150-add-refresh-endpoint.md
  T151-add-token-validation.md
  T152-add-rate-limiting.md
```

```markdown
---
id: T150
title: Add refresh endpoint
status: Todo
milestone: token-refresh-backend
groupId: token-refresh
repos: [engy-api]
blockedBy:
  - projects/auth-revamp/tasks/T149.md
documentSlug: specs/auth-revamp/spec.md
planSlug: projects/auth-revamp/plans/T150-plan.md
importance: Important
urgency: Urgent
---

## Description
Add the `/auth/refresh` endpoint...
```

**Relationships are file paths.** `blockedBy`, `documentSlug`, `planSlug` — all just relative paths within `.engy/`. No separate relationship files. Files declare, databases derive.

**Broken link detection:** `engy validate` walks all frontmatter references and checks if paths exist. Git blame tells you when and who broke it.

### ChromaDB as Universal Search

ChromaDB indexes all text content across all types — system docs, specs, tasks, memories, archived projects. This enables:

* **Spec writing:** "Show me everything we've discussed about auth across all archived projects, memories, and docs"

* **Task decomposition:** RAG over spec context dir + system docs + related workspace memories + similar past tasks

* **Cross-project discovery:** Archived projects are frozen in files but fully searchable in ChromaDB

### Fleeting Memory Exception

During active agent execution, fleeting memories hit SQLite first (they come in fast and furious). They flush to `.engy/` files on a cadence or at task/group completion. Permanent memories are always files.

## Hierarchy

```text
Workspace (permanent)
  ├── system/ (living source of truth for current state)
  ├── specs/ (pre-project thinking)
  ├── docs/ (shared knowledge)
  ├── memory/ (workspace-level, persistent)
  ├── [unscoped tasks/docs] (ambient work)
  └── projects/
       ├── auth-revamp/ (active)
       │    ├── Milestone 1: "Token refresh backend"
       │    │    ├── Task Group A (shared worktree → 1 PR)
       │    │    │    ├── T150: Add refresh endpoint
       │    │    │    ├── T151: Add token validation
       │    │    │    └── T152: Add rate limiting
       │    │    └── Task Group B (shared worktree → 1 PR)
       │    │         ├── T153: Add rotation logic
       │    │         └── T154: Add rotation tests
       │    ├── Milestone 2: "Frontend auth flow"
       │    │    └── ...
       │    └── memory/ (project-scoped)
       ├── ci-overhaul/ (active)
       └── .archived/
            └── api-migration/ (done, frozen)
```

## Data Model

### Schema (derived from files)

SQLite rebuilds these from frontmatter during reindex:

```text
task.workspaceId  ← always set (parent owner)
task.projectId    ← nullable (null = unscoped/ambient)
task.groupId      ← nullable (tasks with same groupId share worktree + PR)

doc.workspaceId   ← always set
doc.projectId     ← nullable (null = workspace-level doc)

memory.workspaceId ← always set
memory.projectId   ← nullable (null = workspace-level knowledge)
```

This enables clean queries in both directions: "all workspace tasks regardless of project" and "all tasks in this specific project."

### Slug Convention

Slugs use path-style with `/` delimiter, matching the filesystem structure:

```text
Workspace:         engy
Project:           engy/auth-revamp
Task (scoped):     engy/auth-revamp/T150
Task (unscoped):   engy/T200
Doc (scoped):      engy/auth-revamp/D180
Doc (unscoped):    engy/D134
```

Two segments = workspace-level. Three segments = project-scoped. Self-parsing, no ambiguity.

### URL Structure

```text
/w/engy/p/auth-revamp/t/T150    ← project-scoped task
/w/engy/t/T200                   ← unscoped workspace task
/w/engy/d/D134                   ← workspace doc
/w/engy/p/auth-revamp/d/D180    ← project doc
```

Next.js app router handles this with nested dynamic routes.

## Worktree Strategy

Worktrees are **not** tied to projects. They're tied to **task groups** — the shippable unit of work (a set of tasks that become one PR).

```text
Pick up Task Group A (T150, T151, T152) in Milestone 1
  → group knows it touches engy-api
  → create worktree: engy-api/worktrees/auth-revamp-token-refresh
  → create branch: auth-revamp/token-refresh
  → tasks execute sequentially in the same worktree
  → each task produces commits
  → group completes → PR created
  → worktree cleaned up
```

**Why task groups, not projects or individual tasks:**

* **Not per-project** — Too many worktrees (3 repos × 3 projects = 9 before writing code). Projects can be long-lived.

* **Not per-task** — Too much churn. Sequential tasks need to see each other's changes. One task = one PR is too granular.

* **Per task group** — Maps to a PR. Tasks within a group see each other's commits. Worktree lifecycle matches the shippable unit. Clean and purposeful.

**Multi-repo task groups:**

```text
Task Group: "Wire refresh flow e2e"
  repos: [engy-api, engy-app]
  → worktree in each repo
  → agent works across both
  → group done, both cleaned up
```

The workspace defines which repos are available by default. The task group declares which repos it touches — including repos outside the workspace when needed. Worktrees are lazy: spun up when work starts, torn down when done.

### Branch Naming

Derived from project slug + group name:

```text
auth-revamp/token-refresh
auth-revamp/frontend-auth-hook
ci-overhaul/pipeline-migration
```

Clean, traceable, auto-generated from the hierarchy.

## Cross-Workspace Work

Workspace boundaries are **organizational, not technical**. A task group can touch any repo on disk — the workspace just defines the default set.

### Small Coordinated Changes

A project's task can reference repos from other workspaces directly. The worktree gets created in whatever repo, regardless of which workspace "owns" it.

```yaml
# .engy/projects/auth-revamp/tasks/T160.md
---
title: Update shared auth utils
groupId: shared-lib-update
repos: [shared-lib]  # lives in a different workspace
---
```

### Substantial Cross-Workspace Efforts

If changes are large enough, spin up a project in each workspace and track as a dependency. Two projects, two workspaces, linked.

### Memory Follows the Repo

Memory is scoped to repos, not workspaces. When an `engy` project touches a repo that lives under `galaxymaker`, the agent automatically gets repo-scoped memories for that repo — patterns, conventions, past learnings — because memory lookup is by repo.

```text
Agent working on T160 (touches shared-lib)
  → project memories (engy/auth-revamp)
  → workspace memories (engy)
  → repo memories (shared-lib) ← comes from wherever, doesn't matter
```

The repo is the universal join key across workspace boundaries. Workspaces organize *your work*. Repos organize *knowledge about code*. They're orthogonal — no special cross-workspace memory plumbing needed.

### Cross-Workspace Context for Specs

For spec research that needs docs from another workspace: copy the relevant material into the spec's `context/` dir. The copy lives with the spec, is self-contained, and doesn't break. ChromaDB can still search across workspaces for discovery, but the actual reference is a local copy.

## Workflow / Agentic Execution

### The Full SDD Loop

```text
SYSTEM DOC (current state) + WORKSPACE MEMORY
  ↓ (agent reads for context)
SPEC (proposed change, with context/ dir)
  ↓ (user approves)
PROJECT (created from spec)
  ↓
PLAN (agent decomposes into milestones → groups → tasks)
  ↓ (user reviews/approves)
EXECUTE (runner picks up task groups)
  ↓
  ├── task groups execute, worktrees created lazily
  ├── validation per task (IMPLEMENTING → VALIDATE_SHELL → VALIDATE_CUSTOM → VALIDATE_CLAUDE → COMMIT)
  ├── group completes → PR
  ├── fleeting memories accumulate
  ↓
COMPLETE
  ├── all milestones done
  ├── memory distillation runs
  ├── system docs updated with changes  ← closes the loop
  ├── project archives
  └── worktrees cleaned up
```

### Parallelization

Task groups on independent repos can run in parallel — separate worktrees, no conflicts. The dependency graph becomes partially repo-aware:

```text
[engy-api] Group: "Add endpoints" ──┐
                                      ├── [engy-api, engy-app] Group: "Wire e2e"
[engy-app] Group: "Add auth hooks" ──┘
```

Milestones can also parallelize when independent.

## Memory Architecture

Memory tiers map directly to the workspace/project/repo hierarchy:

### Workspace Memory (persistent)

* Cross-project learnings ("this testing pattern works well")

* Organizational decisions and preferences

* `memory.workspaceId` set, `memory.projectId` null

### Repo Memory (persistent, cross-workspace)

* Repo patterns, conventions, architectural decisions

* Scoped to the repo, not the workspace — available to any project touching that repo

* The universal join key across workspace boundaries

### Project Memory (ephemeral, freezes on archive)

* Decisions made during this project

* Context about the specific approach

* Task outcomes, agent observations

* `memory.workspaceId` set, `memory.projectId` set

### Memory Lifecycle

**During execution:** Implementation agents emit fleeting memories (project-scoped, buffered in SQLite, flushed to files). Synthesis agent (ACE Reflector) triages against permanent memories. Novel insights promote to permanent notes.

**On project archive:** Memory distillation runs:

1. Project-specific decisions freeze with the archive (queryable but inactive)

2. Workspace-worthy learnings promote up — `projectId` gets nulled, becoming workspace memory

3. Repo-worthy patterns promote to repo memory — available to future projects across any workspace

4. Stale/redundant memories get pruned

**Context injection for agents:**

* Working in a task → sees: project decisions → workspace patterns → repo conventions (for all repos the task touches)

* Planning a new project → sees: system docs + workspace memories + repo memories + archived sibling project memories

### Memory Promotion

Promotion during archive is mechanically simple: null out the `projectId` on memories worth keeping at workspace level, or move to repo-scoped memory. The ACE pipeline's Reflector evaluates which project memories contain novel, reusable knowledge vs. project-specific context.

## Filesystem Structure

Everything maps to a local directory, all in git:

```text
.engy/
  workspace.yaml              # repos, config
  system/                     # living source of truth (current state)
    overview.md
    authentication.md
    task-management.md
    api.md
    database.md
    deployment.md
  specs/                      # pre-project thinking (proposed changes)
    auth-revamp/
      spec.md
      context/
        current-auth-flow.md
        competitor-research.md
    ci-overhaul/
      spec.md
      context/
        current-pipeline.yaml
  docs/                       # org knowledge (conventions, guides)
    coding-conventions.md
    api-style-guide.md
  memory/                     # workspace-level persistent memory
  projects/
    auth-revamp/              # active
      tasks/
        T150-add-refresh-endpoint.md
        T151-add-token-validation.md
      plans/
        T150-plan.md
      memory/
    ci-overhaul/              # active
    .archived/
      api-migration/          # done, frozen
```

**Benefits:**

* Git is the sync layer, versioning, backup, and collaboration tool

* No database migration or backup strategy — `engy reindex` rebuilds everything

* Archived projects become git history (`git log` the evolution of an initiative)

* Any tool (Claude Code, editors, scripts) can read context without Engy running

* Push to GitHub = all notes backed up and shared

* Clone + reindex = fully working on a new machine

## Active Work Dashboard

With ephemeral projects, tracking active work becomes natural:

```text
Workspace: engy
  Active Projects:
    auth-revamp     ██████░░░░ 60%  (3/5 milestones)
    ci-overhaul     ██░░░░░░░░ 20%  (1/5 milestones)
    plan-mode       █████████░ 90%  (4/5 milestones)
  
  Archived: 12 projects
```

At a glance: what's in flight, what's stalled, what's done. Accountability for AI workflows — "auth-revamp has been stuck on M3 for a week" instead of signal buried in a flat task list. WIP limits become visible.

## Migration Path

1. Rename current Project entity → Workspace

2. Introduce new Project entity underneath (ephemeral, archivable)

3. Add `workspaceId` to tasks, docs, memories

4. Make `projectId` on tasks/docs nullable (null = unscoped workspace-level)

5. Migrate data to `.engy/` file structure as source of truth

6. Implement `engy reindex` to rebuild SQLite + ChromaDB from files

7. Update MCP tools, queries, API routes for workspace/project hierarchy

8. Update URL routing to `/w/{workspace}/p/{project}/...` pattern

9. Add `groupId` to tasks for worktree/PR grouping

10. Create initial `system/` docs from existing codebase knowledge

## Known Pitfalls

* **Small task overhead** — Need the unscoped bucket so quick fixes don't require project ceremony

* **Long-running projects** — If a project takes 3 months, it's not really ephemeral. Accumulates same mess. Model works best with short-lived projects.

* **Memory promotion quality** — Automated distillation may promote noise. Need the ACE Reflector to be selective.

* **System doc update quality** — Auto-updating system docs on project completion needs to be accurate. Bad updates compound. May need human review step initially.

* **Cross-project changes** — Work that doesn't fit cleanly into one project's scope. Mitigated by allowing task groups to reference any repo on disk.

* **Migration surface area** — Every MCP tool, query, and route that takes `projectSlug` needs workspace awareness.

* **Write performance** — Every status change is a file write. Fine for 20-50 tasks per project, may need buffering for high-frequency agent operations.

* **Fleeting memory throughput** — Agents emit memories fast during execution. Buffer in SQLite, flush to files at task/group boundaries.

## Status

**Design phase.** This document captures the vision from a brainstorming session. Not scheduled for implementation — Engy's current milestone work takes priority. This is the "write it down before it evaporates" artifact.
