# Engy: Workspace Model

## The Problem

Software projects need two things that pull in opposite directions: a **permanent home** for ongoing concerns (a codebase, a product, a team's accumulated knowledge) and **ephemeral scopes** for bounded pieces of work (a feature, a refactor, a bug fix). Most tools force one entity to do both, and it's bad at both.

Work often spans multiple repositories, but organizational entities typically bind to a single directory. There's no way to represent multi-repo topology. Worktrees and branches accumulate with no lifecycle management. Planning documents need a home that isn't tied to an execution scope. Everything lives in a permanent flat structure — no distinction between active, stalled, and completed work. After work completes, specs go stale and code becomes the only truth. No living document describes what the system actually *is* right now.

Beyond the data model problems, there's a workflow problem: engineers bounce between their IDE, terminal, GitHub, project management tools, and documentation sites. Context scatters across tools. AI-assisted workflows make this worse — agent output lands in one place, review happens in another, and feedback requires manually bridging the gap.

## Assumptions and Scope

This vision targets a **single-user, AI-assisted workflow** — one developer working with AI agents on their own codebases. Features like PR reviewer comment triage and notification systems serve the solo developer interacting with the outside world (open source maintainers, teammates reviewing your PRs) — not multi-user collaboration within Engy. Multi-user is a future concern — the architecture should support it without a rewrite, but it's not a design constraint today.

**Git provider:** GitHub only (via `gh` CLI). GitLab/Bitbucket are future considerations.

Engy is the **single environment** for the entire development lifecycle. An engineer should never need to leave the app from idea through spec through implementation through review. The app provides the visual layer (dashboard, diff viewer, spec browser) and an embedded AI terminal provides the action layer — available on every page, powering every stage of the workflow.

### Two AI Runtimes

Engy has two distinct AI runtimes:

**Claude Code CLI (xterm) — synchronous, interactive.** The terminal panel on every page. The user is present and driving. Powers spec authoring, planning, ad-hoc queries, manual feedback, system doc updates.

**Claude Agent SDK via Mastra — asynchronous, autonomous.** Background agent work orchestrated by Mastra. Agents run without a live terminal session — you kick off a task group or spec research task, the agent executes autonomously, results surface when done. Mastra provides agent lifecycle management, tool coordination, workflows, and memory integration.

**Why two runtimes:** The split keeps interactive work snappy (Claude Code CLI is optimized for conversational back-and-forth) while heavy lifting runs in the background (Agent SDK agents are optimized for autonomous multi-step execution). The SDK boundary also matters for implementation — async agents need persistent sessions, crash recovery, and orchestration (Mastra), while the terminal is a live process.

The two runtimes connect at the **feedback boundary**. When you review diffs or documents and leave comments, feedback routes to the appropriate target: the live terminal session or an async agent (which Mastra resumes with your feedback as new context). The review interface doesn't care which runtime produced the work.

## Spec-Driven Development

Engy embraces spec-driven development (SDD) — specs are the primary artifact, driving AI agent implementation. The core loop: **Specify → Plan → Tasks → Implement**.

Engy extends SDD with two things most SDD tools lack:

**Memory and learning.** The system learns from past implementations and feeds that back into future planning. Most SDD tools are stateless — every project starts from zero context.

**Lifecycle and disposal.** Specs don't drift because projects are short-lived. The spec drives a bounded piece of work, the project completes, its valuable outputs get extracted (memory promotions, system doc updates), and the project is archived. The outcomes survive; the process becomes read-only reference.

***

## Interaction Model

Engy has two interaction surfaces that work together on every page:

### The Terminal Panel (Claude Code CLI)

The right side of the app hosts Claude Code CLI in an xterm terminal. This is the primary way users *do things* — the action layer for the entire workflow. The terminal is always available. The app's visual UI shows you the *state* of things. The terminal is how you *change* things.

Every stage of the SDD loop is driven through the terminal via **Claude Code skills**: spec authoring, planning, execution monitoring, review feedback, system doc updates, memory management, and ad-hoc work.

**Context-scoped terminal.** The terminal adapts to where you are in the app — both its working directory and its default agent:

| Location                          | Working Directory      | Default Agent                                                                  | Scope                           |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Spec page                         | `specs/{slug}/`        | `engy:spec-assistant` — drafting, research tasks, context files                | Writes scoped to spec dir       |
| Project overview / Tasks          | Project's primary repo | `engy:project-assistant` — milestone planning, group creation, task management | Writes to repo via worktrees    |
| Diffs tab                         | Task group's worktree  | No special agent — CLI with diff context injected                              | Ad-hoc feedback, "explain this" |
| System docs page                  | `system/`              | `engy:write-sysdocs` — editing system docs                                     | Writes scoped to system dir     |
| Default project / workspace Tasks | Workspace root         | `engy:workspace-assistant` — quick bugs, one-offs, ad-hoc queries              | General purpose                 |
| Home page                         | No terminal            | —                                                                              | —                               |

**Access outside scope is read-only via MCP.** When the terminal is scoped to a spec directory, the agent can still search system docs, read memories, and browse other specs — but only through MCP tools (read-only). Direct filesystem writes are limited to the scoped directory. This prevents accidental cross-contamination while keeping all context accessible.

**Agent auto-start.** When you open the terminal on a page, the appropriate agent starts automatically (e.g. `claude --agent engy:spec-assistant`). You're immediately productive in the right context — no setup, no "load this spec" preamble.

**Open terminals keep their scope.** Once a terminal is open, navigating to a different page does NOT change that terminal's scope. Need a different context? Open a new terminal. Each open terminal displays a metadata label indicating what it's scoped to (e.g. "spec: auth-revamp", "project: engy", "workspace: general"). This keeps things simple — no confusing scope switching mid-conversation.

**Multi-terminal.** Terminals are managed as tabs (like VS Code). Multiple terminals can be open simultaneously with different scopes. Tabs can be split vertically or horizontally for side-by-side work. The terminal panel is drag-resizable.

### The Diff Viewer

The diff viewer is Engy's review and commit interface. **All code changes flow through it.** It's scoped per task group — each group has its own worktree/branch, and you review one group at a time. If a project has multiple groups with diffs, you select which group to view (hidden if only one group).

Three view modes: **Latest Changes** (default — pending review, with line-level commenting and approve/request changes), **Commit History** (commits on this group's branch, click for individual diffs), **Branch Diff** (all changes vs origin main/master — the "what will this PR look like" view).

**Feedback routing.** You review diffs and leave line-level comments as you go. When done, you either **Approve** (triggers pre-commit gate → auto-commit) or **Send Feedback** (batches all comments into a structured payload and routes them to the originating agent session or terminal). The agent revises in the same worktree, and you see the updated diff. Same batched model as document feedback — one full review pass, then act.

**Pre-commit gate.** Each repo directory in workspace settings can have its own pre-commit command (e.g. `yarn blt` for the frontend, `cargo test` for a Rust service). This runs automatically after the agent completes work in that repo's worktree, before committing. If it fails, the agent tries to fix. If it can't, it notifies the user. Repos with no command configured skip the gate. The agent also runs tests organically during execution, but the configured command is the enforced gate.

**Auto-commit on approval.** When you approve diffs and the pre-commit gate passes, the agent commits automatically — staging files, generating a commit message from task/plan context.

**PR lifecycle.** After committing, the agent pushes and creates a PR via `gh` CLI. Once open, Engy polls PR status. **CI failures** trigger the agent to diagnose and fix autonomously (mechanical fixes like linting, type errors, missing deps). **Reviewer comments** are pulled back into the diff viewer for you to triage — you read them, select which ones to address, and click "Fix Selected" to dispatch the agent with just those comments as context. The agent fixes, new diffs appear for your review (same approve/send feedback loop). Comments you don't select can be responded to manually or dismissed. This avoids wasting tokens on changes you might not agree with. Unresolvable CI issues notify the user.

The diff viewer is used for **all** commits, not just agent-produced code. Manual worktree changes show up too. It's the single commit interface. System doc updates proposed during project completion also appear here.

### Document Feedback

Agents also produce documents (spec drafts, context files). These are reviewed in the content editor with **inline comments**. Same model as diff review: you do one full review pass, leave comments, then **Approve** or **Send Feedback**. Feedback batches all comments into a structured markdown payload and routes to the originating agent session or terminal. Comments clear after sending.

**One review model everywhere.** Diffs and documents both use the same batched feedback pattern: review → comment → approve or send feedback. The only difference is the rendering (diff view vs content editor).

### How They Work Together

```text
┌─────────────────────────────────┬──────────────────────┐
│   Main Content Area             │   Terminal Panel      │
│   (dashboard / spec browser /   │   (Claude Code CLI    │
│    project view / diff viewer)  │    in xterm)          │
│                                 │   Context-aware,      │
│   Async agents (Agent SDK via   │   always available    │
│   Mastra) run in background —   │                       │
│   results surface here          │                       │
└─────────────────────────────────┴──────────────────────┘
```

The main content area changes based on where you are. The terminal persists. The diff viewer and content editor occupy the main area when reviewing changes — the terminal stays open beside them for nuanced feedback.

### The Content Editor

A rich markdown editor (block-based, like BlockNote) for specs, system docs, shared docs, and memories. Supports inline comments that route to the active terminal session or agent session. Same interface for all document types.

### Notifications

Engy is designed for async workflows. Notification triggers: agent needs input (most urgent — agent is stalled), task group ready for review, unresolvable CI failure, PR review received, milestone completed, project ready for completion, system doc update proposed, validation warnings.

Notifications link directly to the relevant view with terminal contextualized to the right session.

### Global Search

Powered by ChromaDB (vector search) and SQLite (structured queries). Surfaces in two ways:

**UI search bar** — available on every page. Type a query and get results across all content types (system docs, specs, memories, active tasks, plan content). Results grouped by type, clicking opens in the appropriate view.

**Terminal search** — the AI in the terminal searches the same index via MCP tools. "What do we know about rate limiting?" triggers a search across memories, system docs, and active project content. The AI interprets results, connects dots across sources, and answers follow-up questions — conversational exploration rather than a list of links.

***

## Core Concepts

### Workspace (the permanent home)

A **Workspace** is a permanent entity representing an ongoing concern — a codebase, a team, a product. It defines the topology (which repos), holds shared knowledge, and contains ephemeral projects.

**Workspace creation.** Created from the Home page. Name + one or more repo directories. Repos can be full repositories or subdirectories within a monorepo — you only scope the parts you care about. The `.engy/` directory is created and a Default project is auto-created.

**Bootstrapping.** For existing codebases, a bootstrap skill reads the codebase and proposes initial system docs (`system/` directory structure, `overview.md`, feature docs, technical docs). The user reviews and approves the generated docs — same review flow as everything else. This solves the cold-start problem: without system docs, specs have no context.

The workspace acts as the template for project creation — projects inherit repos, conventions, shared docs, and memory automatically.

A workspace owns: **Repos** (git repositories or subdirectories in scope), **System docs** (canonical description of the system), **Shared docs** (conventions, style guides — user-created, any content), **Specs** (pre-project thinking spaces), **Memory** (persistent knowledge), **Default project** (permanent scratchpad), and **Projects** (ephemeral execution scopes).

### Settings (hierarchical, context-aware)

**Global settings** (Home page): `.engy/` directory location (default: `~/.engy/`, configurable to any path — e.g. a `docs/` dir in an existing repo), default AI model, notification defaults, appearance.

**Workspace settings** (workspace page): repo directories (including monorepo subdirectory scoping, each with an optional pre-commit command), agent configuration (model, tools, MCP servers), notification overrides, terminal defaults, dev container configuration (enabled flag, allowed network domains, extra packages, environment variables, idle timeout).

No project-level settings — projects inherit from their workspace. The settings icon is context-aware: opens the appropriate level based on where you are.

### IDE Integration

Engy is not an IDE — it's the orchestration and review layer. Engineers use their own editor for manual code editing. **"Open in VS Code" button** appears anywhere a file path or worktree is referenced (diff viewer, task detail, project overview), opening via the `code` CLI.

### Default Project (the workspace scratchpad)

Every workspace has a **Default project** — auto-created, can't be deleted or completed. Home for ambient work: quick bugs, one-off tasks, exploratory work. Flat task list with dependencies, no milestones or task groups. Both `ai` and `human` tasks. Shows first in workspace overview.

**Per-task completion.** When a task is done, the agent evaluates whether it produced anything worth capturing (memory promotion, system doc update). If so, same review flow. If not, dismiss and move on.

### System Docs (the living source of truth)

The `system/` directory is the canonical description of what the system IS right now. Organized into `features/` (BDD-style behavior docs), `technical/` (architecture and infrastructure), and `overview.md` as the index. The directory structure IS the context scoping — agents read only the relevant files.

**The feedback loop:** System docs provide context for specs → specs drive projects → completed projects propose system doc updates (reviewed in the diff viewer) → system docs evolve. Updates are a reviewable step, not an automatic side effect.

**Taxonomy evolution:** New system doc files can be proposed by the completion skill when a project introduces a genuinely new domain. Conflict handling is sequential — updates are reviewed one at a time, like PRs to main.

### Specs (pre-project thinking spaces)

Specs live at the workspace level. A spec is a directory containing `spec.md` plus a `context/` subdirectory with supporting research. Self-contained — everything an agent needs to understand the proposed change.

**Spec tasks** use the same task system as projects (same `tasks` table, `specId` set instead of `projectId`). Flat list with dependencies, no milestones or groups. AI research tasks produce context files via Mastra agent sessions; human tasks are checkboxes. A spec can't move to Ready until all tasks are done or dropped.

**Vision specs** are foundational documents too large to execute as a single project. Lifecycle: Draft → Completed (no project path). They serve as shared references for child specs, which are carved from them and become individual projects. Numerical prefix establishes build order.

**Buildable spec lifecycle:** Draft → Ready → Approved → Active (project exists) → Completed. Status tracked in `spec.md` frontmatter.

**Spec → Project transition:** Project record created in SQLite from spec slug. Planning begins (milestones with rough scope). Spec status updates to Active.

**Specs are living documents.** The spec is never frozen. Users can edit the spec at any time during project execution — then go to the associated project and re-plan as needed. The spec is the source of truth, not a snapshot. No artificial blockers.

### Project (the ephemeral execution scope)

A **Project** is a scoped unit of work. **Projects live entirely in SQLite** — they are execution state, not knowledge. When complete, valuable outputs are extracted and the project is archived.

A project contains: **Milestones** (rough scope from project planning, detailed via milestone planning), **Tasks** (ai or human, organized under milestones), **Task Groups** (tasks sharing a worktree/branch, ship as one PR), **Plan content** (in SQLite), **Agent sessions** (persistent, resumable), and **Project-scoped memory**.

**Project lifecycle:** Planning → Active → Completing → Archived. **A project is a process, not an artifact.** It runs, produces outcomes, and is archived. Users can manually advance projects to Completing at any time (remaining work is dropped, memory distillation and system doc review still run). Archived projects are compacted and read-only. **What survives:** plan content (milestones, groups, task structure with descriptions), key decisions, and final task statuses — the "what was planned and what happened." **What's dropped:** agent session state, fleeting memories (already triaged), execution logs — the moment-by-moment "how." Keeps archives lightweight while answering "how was this built." Archived projects can be fully deleted later if no longer needed.

### Agent Sessions

An **Agent Session** is a persistent, resumable agent instance (Claude Agent SDK, orchestrated by Mastra). Sessions tie to either a task group (project execution) or an individual spec task (research).

Each session has: full context (spec, plan, tasks, memories, system docs), worktree access, a stable session ID (for feedback routing), and continuity (crash-resumable, feedback arrives in the same session).

**Why sessions matter:** The agent that receives your feedback is the same agent that made the original decision — it knows *why* and can make an informed revision. Without persistent sessions, feedback is disconnected.

### Dev Containers (optional sandboxed execution)

Async agents need filesystem and shell permissions that users must normally approve manually — breaking unattended workflows. **Dev containers** are an optional, per-workspace Docker environment that solves this: agents run with full permissions inside a container whose network is locked down via an iptables allowlist, preventing data exfiltration.

Containers are **on-demand** — the client daemon starts one when a task group activates and stops it after a configurable idle timeout. Each workspace gets one container with all configured repos bind-mounted. Agents work in git worktrees inside the container, so the host's main branch stays untouched.

The network firewall allows Anthropic API, GitHub, and npm by default; workspaces add custom domains (private registries, external APIs) in settings. Without containers enabled, the system works exactly as before — standard Claude Code permission model.

See `context/dev-containers.md` for the full design.

### Task Groups (the shippable unit)

A **Task Group** is a set of tasks that ship together as one PR. It's the unit of worktrees, branches, agent sessions, and parallelization. One agent session per group.

**Lifecycle:**

```text
Planned → Active → Review → PR Open → Merged → Cleaned Up
                ↕
             Paused
                ↓
             Stopped → (Restart) → Active
```

* **Planned:** No worktree yet. **Active:** Worktree created, agent running, diffs flowing. **Paused:** Session suspended, worktree preserved. **Stopped:** Session killed, can restart with notes. **Review:** Diffs awaiting review, feedback routes to session. **PR Open:** Engy monitors CI/reviews — agent auto-fixes CI failures; reviewer comments are triaged by user who selects which to dispatch agent on. **Merged/Cleaned Up:** Terminal states.

**Group controls:** Pause, Stop, Resume, Restart, Complete — available from project overview, dependency graph, swimlane, PR tab, and task detail. Controls operate at the group level. **Complete** allows manually closing a group (e.g. remaining tasks are no longer needed), skipping the PR flow.

**Execution visibility:** Three zoom levels — project overview (which agents running), dependency graph (task statuses), task detail (Content | Log tabs with real-time execution stream).

**Cross-repo groups** create one worktree per repo. Diffs from all repos appear together in the viewer. Commits and PRs happen independently per repo — one repo can have its PR open while the agent is still fixing the other. The group doesn't advance to Merged until all repos' PRs have merged. No forced atomicity, just sequenced completion tracking.

**Creation** happens during milestone planning. Groups can be reorganized before Active — once work starts, the group is locked. If real work reveals that groupings were wrong (e.g. tasks in different groups need to touch the same files), the answer is Stop the affected groups and re-plan the milestone. The planning skill creates new groups with the corrected task distribution. This is intentionally manual — groups map to worktrees and branches, so regrouping means branch surgery.

**Activation.** By default, users manually start groups. An optional auto-start mode activates groups automatically when their dependencies resolve — useful for hands-off execution of well-planned milestones.

### Milestones

A **Milestone** is an organizational grouping of task groups. Lifecycle: **Planned → Planning → Active → Complete.** Milestones can run in parallel when independent. Completion drives dashboard progress indicators. Users can manually complete a milestone at any time (remaining work is dropped).

### Progressive Planning

Planning is progressive, not upfront. Each level has its own plan loop:

1. **Project planning** — Spec → milestones with rough scope. No tasks yet.

2. **Milestone planning** — When ready, decomposed into groups and tasks with full context from earlier milestones.

3. **Task planning** (optional) — User triggers a planning loop for a task. Agent produces an implementation plan, user approves, and that plan guides the agent's execution. The task stays as-is — it just gets an approved plan attached.

All three levels use the same planning skill and terminal interaction. Plan just-in-time, with maximum context.

### Project Views

Three views over the same SQLite data:

**Dependency graph** (default during execution) — tasks as nodes, dependencies as edges, groups as clusters. Color-coded by status, click for task detail.

**Eisenhower matrix** — urgent/important quadrants. Best for human task prioritization and Default project tasks.

**Swimlane board** — milestone lanes, task group cards. Compact progress overview.

### Cost Visibility

Claude Code CLI tracks its own token usage. For async agents, Engy tracks usage per session, group, and project — surfaced in execution logs, project overview, and workspace settings. Awareness, not gatekeeping.

### Error Handling

Infrastructure-level errors beyond agent retry logic: **Network failures** (retry with backoff, pause and notify if persistent), **API rate limits** (queue and wait, Mastra coordinates), **Git conflicts** (group stays in Review, resolve in worktree), **Repo access** (clear error, user fixes, restart group), **Database** (WAL mode, backup strategy).

Agent crash mid-execution: worktree preserved, session resumable from SQLite, only in-progress task needs restart.

Database loss: active projects gone, but specs, merged PRs, and promoted memories survive. Re-create project from spec — annoying, not catastrophic. SQLite can optionally live in `.engy/` for git backup.

Principle: every error auto-recovers or surfaces as a notification with clear next steps. No silent failures.

### Task Templates (via Claude Skills)

Repetitive workflows are handled through Claude Code skills, not a separate template system. Skills encapsulate how to create specs, plan projects, or scaffold code for particular patterns — dynamic (pull from system docs and memory), not static.

***

## Storage Architecture

### Knowledge in Files, Execution in Database

**Things that accumulate lasting value are files (git-tracked). Things that are transient execution state live in SQLite.**

```text
FILES (.engy/, git-tracked — permanent knowledge)
  ├── workspace.yaml          # repos (incl. subdirs), settings, config
  ├── system/                 # what the system IS right now
  ├── specs/                  # what was proposed (living documents, editable during execution)
  ├── docs/                   # conventions, guides, org knowledge
  └── memory/                 # promoted workspace + repo memories

SQLite (ephemeral execution state)
  ├── projects, milestones, task_groups, tasks
  ├── agent_sessions
  ├── fleeting_memories, project_memories
  └── plan_content

ChromaDB (vector search index)
  └── everything embedded — files + active DB content
```

Files hold **knowledge** — lasting value, git-versioned, survives project deletion. SQLite holds **execution state** — fast reads/writes, relational queries, transient by nature. ChromaDB indexes both for universal search, always rebuildable via `engy reindex`.

See `context/filesystem.md` for the full directory structure reference.

### Database Entities

**Projects** — Name/slug, status, timestamps, spec reference, `isDefault` flag.

**Milestones** — Title, project reference, status (Planned/Planning/Active/Complete), ordering, scope description.

**Task Groups** — Group name, milestone reference, status, repos list.

**Tasks** — Title, description, status, type (`ai`/`human`), milestone reference, group reference, dependencies, importance/urgency. Nullable `projectId` and `specId` — belongs to one scope.

**Agent Sessions** — Session ID, task group reference, session state/context, status.

**Fleeting/Project memories** — Working notes and project-scoped decisions. Evaluated for promotion on completion.

### MCP Server (AI Access Layer)

The AI terminal accesses Engy's data through an **MCP server**. Database operations go through MCP tools (validation, transactions, audit trail). File reads go through MCP tools. File writes go direct to filesystem (leveraging Claude Code's native capabilities).

| Content                                 | Read      | Write               |
| --------------------------------------- | --------- | ------------------- |
| SQLite (projects, tasks, memories)      | MCP tools | MCP tools           |
| Files (system docs, specs, shared docs) | MCP tools | Direct filesystem   |
| ChromaDB (search)                       | MCP tools | Automatic (reindex) |

MCP tools: project management (`createProject`, `getProject`, `updateProjectStatus`, `deleteProject`), task management (`createTask`, `updateTask`, `getTasks`, `getTasksByGroup`, `getTasksBySpec`), memory (`createFleetingMemory`, `promoteMemory`, `searchMemories`), planning (`createMilestone`, `planMilestone`, `createTaskGroup`, `replanTask`, `getPlan`), search (`search`, `getDocument`), workspace (`getWorkspaceConfig`, `getRepos`).

### Validation

`engy validate` checks: broken links in frontmatter references, schema compliance, duplicate IDs, orphaned content, lifecycle consistency. `engy reindex` rebuilds ChromaDB. Both available as terminal skills.

***

## Memory Architecture

Memory is structured knowledge that accumulates as work happens — the mechanism by which Engy learns.

### Permanent Memory Schema

Permanent memories live as markdown files in `.engy/memory/` with YAML frontmatter (id, type, subtype, title, scope, repo, confidence, source, tags, linkedMemories, timestamps). Subtypes: `decision` (why something was done), `pattern` (reusable approach), `fact` (verified truth), `convention` (team practice), `insight` (higher-order observation).

**Fleeting memories** (SQLite) are lightweight agent working notes — fast to create, triaged later. **Project memories** (SQLite) are project-scoped decisions, evaluated for promotion on completion.

### Memory Scoping

**Workspace memory** (`scope: workspace`) — cross-project learnings. **Repo memory** (`scope: repo`) — repository-specific patterns, filtered by `repo` field. The repo field is the universal join key across workspace boundaries.

### Memory Lifecycle

**During execution:** Agents emit fleeting memories (SQLite). Synthesis triages against existing permanent memories at task group boundaries. Novel insights promote immediately.

**On completion:** Project memories evaluated for promotion. Valuable learnings written to `.engy/memory/`. Deduplication updates existing memories rather than creating duplicates. Everything else deleted with the project.

### Context Injection

Agents receive memories in order: project memories (SQLite) → workspace memories (files) → repo memories (files, filtered by `repo`). When planning new projects, agents see system docs + workspace memories + repo memories.

***

## Cross-Workspace Work

Workspace boundaries are organizational, not technical. A task group can touch any repo on disk. Small coordinated changes reference repos directly. Substantial efforts use projects in each workspace, coordinated at the human level. Memory follows the repo — the `repo` field is the universal join key.

For spec research needing docs from another workspace: copy relevant material into the spec's `context/` dir.

***

## Known Tradeoffs and Open Questions

**Short-lived project assumption.** Best with projects completing in days to weeks. Mitigation: scope tightly, split large efforts, complete aggressively.

**Archived project utility.** Archived projects preserve structure but lose live execution state. The bet: between the archive (task decomposition, decisions), specs (intent), git (implementation), and memories (learnings), enough context survives for debugging and understanding past work.

**System doc update quality.** Subtle inaccuracies can slip through review. Periodic full audits may be needed.

**Memory promotion quality.** Err on keeping less (high precision). Users can manually promote via terminal. A periodic **memory review** surfaces recent unpromoted candidates so users can catch valuable insights the automated promotion missed.

**Database as single point of failure.** Standard SQLite reliability practices apply. Optionally commit `.engy/engy.db` to git for backup.

**ChromaDB rebuild cost.** Full reindex is the slowest recovery operation but fully automated.

**Terminal skill boundaries.** Experience quality depends on skill quality. Skills must cover the full SDD loop without forcing raw commands, while allowing power users to drop to raw Claude Code.
