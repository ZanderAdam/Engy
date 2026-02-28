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

### Two AI Runtimes

Engy has two distinct AI runtimes serving different interaction patterns:

**Claude Code CLI (xterm) — synchronous, interactive.** The terminal panel on every page is Claude Code CLI rendered in an xterm terminal. The user is present and driving. This powers spec authoring, planning, ad-hoc queries, manual feedback, system doc updates — anything where you're actively working with the AI in real-time. Same approach as Engy 1.

**Claude Agent SDK via Mastra — asynchronous, autonomous.** Background agent work is built on the Claude Agent SDK, orchestrated by Mastra. These agents run without a live terminal session. You kick off a task group or a spec research task, the agent executes autonomously, results appear when it's done. Mastra provides the orchestration layer: agent lifecycle management, tool coordination, workflows, and memory integration.

The two runtimes connect at the feedback boundary. When you review diffs or context files and leave comments, that feedback routes to the appropriate target: the live terminal session (if you're actively co-working with the CLI) or an async agent (which Mastra resumes with your feedback as new context). The diff viewer and content editor don't care which runtime produced the work — the review interface is the same.

This split keeps the interactive experience snappy (Claude Code CLI is optimized for conversational back-and-forth) while the heavy lifting runs in the background (Agent SDK agents are optimized for autonomous multi-step execution). Mastra is the uniform orchestration layer beneath the async agents — an agent researching OAuth providers for a spec context file uses the same Mastra infrastructure as an agent implementing the auth endpoint during project execution.

## Spec-Driven Development

Engy embraces spec-driven development (SDD) — the paradigm where specs are the primary artifact, driving AI agent implementation. The core loop: **Specify → Plan → Tasks → Implement**.

Engy extends SDD with two things most SDD tools lack:

**Memory and learning.** The system learns from past implementations and feeds that back into future planning. Most SDD tools are stateless — every project starts from zero context.

**Lifecycle and disposal.** Specs don't drift because projects are short-lived. The spec drives a bounded piece of work, the project completes, its valuable outputs get extracted (memory promotions, system doc updates), and the project is deleted. No long-lived project to maintain, no graveyard of archived tasks. The outcomes survive; the process doesn't.

---

## Interaction Model

Engy has two interaction surfaces that work together on every page of the app:

### The Terminal Panel (Claude Code CLI)

The right side of the app hosts Claude Code CLI in an xterm terminal. This is the primary way users *do things* in Engy. It's not a secondary feature or a power-user escape hatch — it's the action layer for the entire workflow. This is the synchronous, interactive runtime — you type, it responds, you iterate in real-time.

The terminal is **context-aware**. It knows what page you're on, what project is active, what task is selected. When you're viewing a spec, the terminal has that spec's context loaded. When you're in a project, it has the project's tasks and plan. When you're reviewing diffs, it has the diff context. The terminal adapts to wherever you are in the app.

Every stage of the SDD loop is driven through the terminal via **Claude Code skills**:

- **Spec authoring:** "Help me write a spec for auth revamp" — the skill reads system docs and workspace memories for context, asks clarifying questions, drafts the spec and context files, iterates with you until it's right.
- **Planning:** "Plan this spec" — the skill reads the spec + context, proposes milestones/groups/tasks, you iterate in the terminal, the plan materializes in SQLite.
- **Execution monitoring:** The terminal can show status of background agents (Agent SDK via Mastra). For interactive work, you see output in real-time and can intervene, redirect, ask questions mid-execution.
- **Review feedback:** When reviewing diffs, you can give feedback directly in the terminal. For async agent output, feedback routes to the Mastra-managed agent session that produced the work.
- **System doc updates:** "Update system docs for this project" — the skill reads completed tasks and proposes diffs.
- **Memory management:** "What do we know about auth?" — the skill searches workspace and repo memories, surfaces relevant context.
- **Ad-hoc work:** Quick bugs, one-off tasks, questions about the codebase — the terminal handles ambient work that doesn't warrant a project.

The terminal is always available. You're never forced into a form or wizard. The app's visual UI shows you the *state* of things (dashboard, spec browser, task board, diff viewer). The terminal is how you *change* things.

### The Diff Viewer

The diff viewer is Engy's review and commit interface. **All code changes flow through it.** It replaces the workflow of switching to a terminal for `git diff`, switching to GitHub for PR review, switching back for revisions.

The diff viewer is scoped per task group — each group has its own worktree/branch, and you review one group at a time. If a project has multiple groups with diffs, you select which group to view (hidden if only one group).

The diff viewer has three view modes:

- **Latest Changes** (default) — what the agent just produced, pending review. File-level diffs with syntax highlighting, line-level commenting, approve/request changes actions.
- **Commit History** — list of commits on this group's branch. Click to see individual commit diffs. Useful for understanding how the agent arrived at the current state after multiple review rounds.
- **Branch Diff** — all accumulated changes on this group's branch vs origin main/master (`git diff main...HEAD`). The "what will this PR look like" view. Natural place for a final review before PR creation.

**The critical feature: feedback routing.** Every diff is produced by an agent session working on a specific task group. When you comment on a line in the diff viewer, that feedback goes directly back to the agent session that made the change — with full context of which file, which line, and what you said. The agent can then revise its work in the same worktree, and you see the updated diff.

This creates a tight review loop:

```text
Agent completes task → diff appears in viewer
  → you review, comment on line 42: "this should use the cached value"
  → feedback routes to the agent session (with file, line, and comment context)
  → agent revises in the same worktree
  → updated diff appears
  → you approve → agent auto-commits, pushes, creates PR
```

**Pre-commit gate.** Workspaces can configure a pre-commit command (e.g. `yarn blt` — build, lint, test) in workspace settings. This runs automatically after the agent completes work, before committing. If it fails, the agent tries to fix the issues. If the agent can't fix them, it notifies the user. This is a local CI gate — catches issues before they even hit the PR. The agent also runs tests organically during task execution (like any developer would), but the configured command is the enforced gate. You don't rely on the agent remembering to test — the system forces it.

**Auto-commit on approval.** When you approve diffs and the pre-commit gate passes, the agent handles the commit automatically — staging files, generating a commit message from the task/group/plan context. You shouldn't have to write a commit message every time an agent's work passes review. The option to manually commit is still there (via the terminal), but the default path after "approve" is automated.

**PR lifecycle.** After committing, the agent pushes and creates a PR via `gh` CLI — generating the title and description from the spec, plan, and task context. No GitHub UI integration needed; the agent has all the context to produce a good PR description and handles it directly.

**PR monitoring.** Once a PR is open, Engy polls its status — CI results, reviewer comments, review requests. When something needs attention, Engy dispatches the agent or notifies the user:

- **CI failure:** Agent reads the failure logs, diagnoses the issue, fixes, pushes. Straightforward CI fixes (linting, type errors, missing deps) can be handled autonomously. The agent has full context from the original work since the session is still active.
- **Reviewer comments:** Agent pulls comments back into the diff viewer. Comments appear alongside your local review comments — the agent session doesn't care where the feedback originated. The agent addresses feedback, pushes updates.
- **Review requests / approvals:** Status surfaces in the notification system and the task group's status in the project view.

The agent can handle multiple rounds of CI fix → push → re-run without user intervention. If the agent can't resolve a CI failure or a reviewer comment requires a judgment call, it notifies the user and stalls until you weigh in (via the diff viewer or terminal). The full cycle:

```text
You approve diffs → agent auto-commits (contextual message)
  → agent pushes, creates PR via gh (description from plan context)
  → Engy polls PR status
  → CI fails → agent reads logs, fixes, pushes → CI re-runs
  → reviewer comments → agent pulls back, addresses, pushes
  → agent can't resolve → notifies user, stalls
  → all checks pass, approved → PR merged
```

The diff viewer is used for **all** commits, not just agent-produced code. If you make manual changes in a worktree, they show up in the diff viewer too. It's the single commit interface.

**Diff viewer for system doc updates:** When a project completes and system doc updates are proposed, they appear in the diff viewer as diffs against the current system doc files. You review them the same way you review code — comment, request changes, approve. Same interface, same muscle memory.

### Document Feedback

Not all agent output is code diffs. Agents also produce documents — spec drafts, context files from research tasks, plan content. These are reviewed in the content editor, not the diff viewer, and need their own feedback mechanism.

The content editor supports **inline comments** on any document. When reviewing an agent-produced document, you leave comments on specific sections (select text → add comment). When you're done, a **"Send Feedback"** action in the top-right action bar collects all pending comments into a structured markdown payload — with section references and line context — and routes it to the agent session that produced the document. The agent receives the feedback, revises, and the updated document appears. Comments clear after sending.

This is the document equivalent of the diff viewer's line-level commenting. The key difference: diff viewer comments route immediately (one at a time, as you review lines), while document comments are batched and sent explicitly. This matches the different review patterns — code review is incremental, document review is holistic ("read the whole thing, then give feedback").

### How They Work Together

The app layout on any page:

```text
┌─────────────────────────────────┬──────────────────────┐
│                                 │                      │
│   Main Content Area             │   Terminal Panel     │
│   (dashboard / spec browser /   │   (Claude Code CLI   │
│    project view / diff viewer)  │    in xterm)         │
│                                 │                      │
│                                 │   Context-aware,     │
│                                 │   always available    │
│                                 │                      │
│   Async agents (Agent SDK via   │                      │
│   Mastra) run in background —   │                      │
│   results surface here          │                      │
│                                 │                      │
└─────────────────────────────────┴──────────────────────┘
```

The main content area changes based on where you are. The terminal persists. Context flows from the main area to the terminal automatically — if you click on a spec, the terminal knows you're looking at that spec. If you click on a task, the terminal has that task's context.

The diff viewer occupies the main content area when reviewing changes — whether those changes came from the terminal (interactive) or from an async agent (background). The terminal stays open beside it for feedback that needs more nuance than a line comment — "rethink this whole approach" or "can you explain why you did it this way?" For async agent output, comments in the diff viewer route back to the Mastra-orchestrated agent session, which resumes with your feedback as new context.

### The Content Editor

Specs, system docs, shared docs, and memories all need to be viewable and editable. The content editor is a rich markdown editor (block-based, like BlockNote) that renders content in place and supports **inline comments**.

Comments are the review mechanism for non-code content. When a spec moves to Ready and needs review, you (or an agent) read it in the content editor and leave comments on specific sections. These comments are **routable to the active terminal session** — just like diff viewer comments route to agent sessions. If you're iterating on a spec with a Claude Code skill, your comment on paragraph 3 arrives in the same terminal session that drafted it. The agent sees your feedback in context and can revise.

This is the same interface for all document types:

- **Specs:** Draft, review, iterate with comments routed to the spec-writing skill in the terminal.
- **System docs:** View the current truth, edit directly, or review proposed updates (which also appear in the diff viewer for structural changes).
- **Shared docs:** Edit conventions, style guides, org knowledge.
- **Memories:** Browse and edit promoted memories.

The content editor occupies the main content area when you click on any document in the spec browser, system doc browser, or memory browser.

### Notifications

Engy is designed for async AI workflows — you kick off task groups and come back later. Notifications are how the app tells you something needs attention.

Notification triggers:

- **Agent needs input.** A task group's agent session hit a decision point or blocker and needs human guidance. This is the most urgent notification — the agent is stalled until you respond.
- **Task group ready for review.** An agent session completed all tasks in a group. Diffs are in the diff viewer awaiting your review.
- **CI failure (unresolvable).** An agent attempted to fix a CI failure on a PR but couldn't resolve it autonomously. Needs human intervention — links to the diff viewer with failure context.
- **PR review received.** External reviewer commented or requested changes on a PR. Agent is addressing it, but you may want to monitor.
- **Milestone completed.** All task groups in a milestone have been merged. Progress update.
- **Project ready for completion.** All milestones done. Memory distillation and system doc update review are pending.
- **System doc update proposed.** A completion workflow has generated diffs for system docs. Needs review in the diff viewer.
- **Validation warnings.** `engy validate` found issues — broken links, schema violations, lifecycle inconsistencies.

Notifications appear in-app (badge/indicator, notification panel). The notification tells you what happened and links you directly to the relevant view — clicking "Task group ready for review" opens the diff viewer for that group with the terminal contextualized to the agent session.

### Global Search

Search is powered by ChromaDB (vector search across all content) and SQLite (structured queries over execution state). It surfaces in two ways:

**UI search.** A global search bar available on every page. Type a query and get results across all content types — system docs, specs, memories, active tasks, plan content. Results are grouped by type and ranked by relevance. Clicking a result opens it in the appropriate view (content editor for docs, project view for tasks, diff viewer for pending reviews).

**Terminal search.** The AI in the terminal can search via Claude Code skills and MCP tools. "What do we know about rate limiting?" triggers a search across memories, system docs, and active project content, with results synthesized in the terminal. This is more conversational — the agent interprets results, connects dots, and answers follow-up questions.

Both use the same underlying ChromaDB index + SQLite queries. The UI search is for browsing and navigation. The terminal search is for AI-assisted exploration and context gathering.

---

## Core Concepts

### Workspace (the permanent home)

A **Workspace** is a permanent entity representing an ongoing concern — a codebase, a team, a product. It defines the topology (which repos), holds shared knowledge, and contains ephemeral projects.

**Workspace creation.** Created from the Home page. You give it a name and point it at one or more repo directories. Repos can be full repositories or subdirectories within a monorepo (e.g. `monorepo/packages/auth`, `monorepo/packages/api`) — you only scope the parts you care about. The workspace's `.engy/` directory is created in the root of the primary repo (or a designated location for multi-repo setups). A Default project is auto-created along with the workspace.

The workspace itself acts as the template for project creation — no separate template entity needed. When you create a project, it inherits the workspace's repos, conventions, shared docs, and memory automatically.

A workspace owns:

- **Repos** — The git repositories or subdirectories in scope (multiple allowed). These are defaults, not a hard boundary — projects can reference repos outside the workspace when needed. Managed in workspace settings.
- **System docs** — The canonical, always-current description of what the system IS right now. Updated through a review workflow when projects complete.
- **Shared docs** — Coding conventions, style guides, runbooks. Organizational knowledge true across all projects.
- **Specs** — Pre-project thinking spaces with supporting context. The input that drives projects.
- **Memory** — Workspace-level persistent knowledge (patterns, learnings, conventions).
- **Default project** — A permanent project for ambient work: quick bugs, one-off tasks, workspace-level work. Auto-created with the workspace, can't be deleted or completed. See below.
- **Projects** — Ephemeral execution scopes (see below).

### Settings (hierarchical, context-aware)

Settings follow the navigation hierarchy: **global settings** (Home page) and **workspace settings** (workspace page). No project-level settings — projects inherit from their workspace.

**Global settings** (accessible from the Home page header):

- Engy data directory (where `.engy/` lives by default)
- Default AI model preferences
- Notification preferences (global defaults)
- Appearance (theme, layout defaults)

**Workspace settings** (accessible from the workspace page header):

- Repo directories — add/remove repos and subdirectories. Supports monorepo subdirectory scoping.
- Pre-commit command — configurable command (e.g. `yarn blt`) that gates all commits. Runs automatically before agent commits.
- Agent configuration — model preferences, tool access, MCP server configuration for async agents
- Notification overrides — workspace-specific notification preferences
- Terminal defaults — default context, startup behavior

Settings are context-aware: the settings icon in the header opens the appropriate settings page based on where you are (Home → global, workspace → workspace settings).

### IDE Integration

Engy is not an IDE — it's the orchestration and review layer. Engineers use their own editor (VS Code, etc.) for manual code editing. Since task groups operate in git worktrees, the worktree paths are standard filesystem locations that any editor can open.

**"Open in VS Code" button.** Appears anywhere a file path or worktree is referenced: diff viewer file tree, task detail (worktree path), project overview (repo paths). A small icon button that opens the path in VS Code (via the `code` CLI). This bridges the gap between Engy's review/orchestration role and hands-on editing — you spot something in a diff, click to open it in your editor, make a manual fix, and the change shows up in Engy's diff viewer.

### Single User (extensible to multi-user)

Engy is single-user for now. One user, one machine, local SQLite, local filesystem. The architecture should be designed for easy extension to multi-user: Engy hosted centrally, shared workspaces, collaborative doc editing, role-based access (who can approve diffs, who can plan). But multi-user is not in scope for the initial implementation.

### Default Project (the workspace scratchpad)

Every workspace has a **Default project** — auto-created when the workspace is created, can't be deleted or completed. It's the home for ambient work that doesn't belong to a spec-driven project: quick bugs, one-off tasks, exploratory work, workspace-level maintenance.

The Default project uses the same task system as everything else, but with a simpler structure: flat task list with dependencies, no milestones, no task groups (same shape as spec tasks). Both `ai` and `human` task types work here. It has its own terminal context, and shows up first in the workspace overview.

**Per-task completion.** Unlike regular projects (which batch their completion step), the Default project handles completion at the individual task level. When a task is marked done, the agent evaluates whether it produced anything worth capturing — a memory promotion or a system doc update. If it did, you get the same review flow: proposed system doc diffs in the diff viewer, memory promotion prompts. If not (most quick tasks), you dismiss and move on. This prevents valuable work from getting lost in a project that never "completes."

The Default project's tasks are the natural fit for the Eisenhower matrix view — your personal prioritization board for non-project work.

### System Docs (the living source of truth)

The `system/` directory is the canonical description of what the system actually is *right now*. Not aspirational, not a spec — factual. It's the output of completed work, not the input.

```text
.engy/
  system/
    overview.md                 # the map — links to all sections, high-level summary
    features/                   # BDD-style behavior docs (what the system does)
      authentication.md         # "Auth uses JWT, refresh tokens rotate on use..."
      task-management.md
      notifications.md
    technical/                  # architecture and infrastructure (how the system works)
      api.md
      database.md
      deployment.md
```

The directory is organized into two sections. `features/` contains BDD-style behavior documents — each file describes what a feature does, its rules, and its edge cases from the user's perspective. `technical/` contains architecture and infrastructure documents — schemas, API surface, deployment topology, the structural decisions that cut across features.

`overview.md` sits at the root as the index. It's the entry point for any agent or human trying to understand the system — a high-level summary with links into the relevant feature and technical docs. When a new system doc file is created (proposed by a skill during project completion), it goes into whichever section fits. The overview is updated to reference it.

The directory structure IS the context scoping — an agent working on an auth spec reads `system/features/authentication.md` and maybe `system/technical/api.md`, not the whole system.

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

#### Spec Tasks (research and preparation)

Specs have tasks — the same task system used by projects, just scoped to a spec instead. Spec tasks live in SQLite (same `tasks` table, with `specId` set instead of `projectId`) and use the same UI: task list, dependency graph, same agent loop.

Most spec tasks are research that produces context files. "Investigate OAuth providers" → agent researches, writes `context/oauth-providers.md`, you review it in the content editor, send feedback, agent revises. Same loop as project execution — AI tasks spin up agent sessions via Mastra, produce output, you review, give feedback, it routes back to the same session.

Human spec tasks work the same way: "Talk to backend team about rate limiting requirements" is a checkbox. Mixed dependencies are natural — a human task to gather requirements might block an AI research task that analyzes them.

No milestones, no task groups. Spec tasks are a flat list with dependencies. The dependency graph still renders — nodes and edges don't need milestones or groups. This keeps spec-time lightweight while giving you the same visibility into what's blocking, what's running, and what's done.

The spec-writing flow becomes: you create a spec (via the terminal or UI), the spec-writing skill proposes research tasks ("benchmark current auth latency," "review competitor OAuth flows," "pull relevant Slack threads"), you adjust the list, kick off AI tasks, context files accumulate as tasks complete, and the spec gets richer. The spec can't move to Ready until all its tasks are done or explicitly dropped — you don't review a spec that's still missing its research.

Agent sessions for spec tasks work identically to project task sessions. The only difference is the output target: context files in the spec's `context/` directory instead of code changes in a worktree.

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

**Spec authoring** happens through the terminal. You open the spec browser (or start from the dashboard), and use the Claude Code spec-writing skill. The skill reads system docs and workspace memories for context, creates the spec file and context directory, and proposes research tasks. AI research tasks execute via Mastra agent sessions — producing context files that you review and refine. The spec browser in the main content area shows the rendered spec and its task list. The dependency graph view shows what research is in progress, what's blocked, and what's done.

**Spec lifecycle (buildable specs):**

```text
Draft → Ready → Approved → Active (project exists) → Completed
```

- **Draft:** Under active research and writing via the terminal. Mutable. Spec tasks (research, preparation) execute during this phase — AI agents produce context files, human tasks track manual research. The spec can't move to Ready until all tasks are done or dropped.
- **Ready:** Author considers it complete, ready for review. All research tasks are finished and context files are in place. Reviewers (human or AI) read the spec in the content editor and leave inline comments, which route to the terminal session for revision.
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
2. **Planning begins.** A Claude Code planning skill decomposes the spec into milestones with rough scope descriptions. This is iterative — the skill proposes a decomposition in the terminal, you review and adjust, the skill refines. All of this lives in SQLite. The project view in the main content area shows the plan taking shape as you iterate. At this stage, only milestones are defined — groups and tasks come later (see Progressive Planning below).
3. **The spec's status updates** to Active (written to `spec.md` frontmatter).

**One spec, one project** is the default. If a spec is too large for one project, the right move is to split the spec first (into `auth-revamp-phase-1/` and `auth-revamp-phase-2/`), then create a project from each. This keeps the 1:1 mapping clean and specs appropriately scoped.

### Project (the ephemeral execution scope)

A **Project** is a scoped unit of work with a lifecycle. It represents a single initiative, feature, or effort. **Projects live entirely in SQLite** — they are execution state, not knowledge. When a project completes, its valuable outputs are extracted (memories promoted to files, system docs updated) and the project is deleted.

A project contains:

- **Milestones** — Large chunks of work within the project. Defined during project-level planning with rough scope; detailed decomposition happens when the milestone enters its own planning loop.
- **Tasks** — Concrete work items, organized under milestones. Each task has a type: `ai` (executed by an agent session) or `human` (a manual action tracked as a checkbox). The planning agent determines the type at creation time based on the nature of the work. If a task turns out to be more complex than expected, it can optionally go through its own plan loop — which replaces the original task with the finer-grained tasks produced by the planning (see Progressive Planning).
- **Task Groups** — AI tasks sharing a `groupId` ship together as one PR, share a worktree/branch. Human tasks can belong to a group for dependency tracking but don't participate in the agent execution pipeline.
- **Plan content** — The implementation plan created during planning phases. Stored as structured data in SQLite, not as separate files.
- **Agent sessions** — Persistent, resumable sessions tied to task groups (see below).
- **Project-scoped memory** — Decisions, context, and learnings specific to this effort. Also in SQLite. Valuable memories get promoted to file-based workspace memory on completion.

**Project lifecycle:**

```text
Planning → Active → Completing → Deleted
```

- **Planning:** Milestones are being defined via the terminal. This is the project-level plan — rough scope, not detailed tasks. Nothing is executing yet.
- **Active:** Milestones are being planned and executed progressively (see Progressive Planning). Worktrees are created lazily. Diffs flow to the diff viewer.
- **Completing:** All tasks are done or explicitly dropped. Completion process is running: memory distillation, system doc update proposal (in diff viewer), worktree cleanup.
- **Deleted:** Gone. The project's valuable outputs — promoted memories (now files in `.engy/memory/`), system doc updates (now in `.engy/system/`), and merged PRs (now in git) — survive. The project itself, its tasks, its execution history, are discarded. The spec that started it remains in `.engy/specs/` as the permanent record of intent.

This is the key insight: **a project is a process, not an artifact.** It runs, produces outcomes, and is discarded. Keeping dead task records around "just in case" is hoarding — if the outcomes were properly extracted, the execution history is noise.

### Agent Sessions

An **Agent Session** is a persistent, resumable agent instance built on the **Claude Agent SDK** and orchestrated by **Mastra**. This is the asynchronous runtime — distinct from the Claude Code CLI terminal. Agent sessions run in the background without a live terminal; results surface in the diff viewer or content editor when ready.

Sessions can be tied to either a **task group** (project execution) or an individual **spec task** (spec research). For project work, a session is created when a task group becomes Active (or resumed if one already exists for that group). For spec research, a session is created per AI task — each research task gets its own session since spec tasks don't have groups. In both cases, the session has:

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
  → user approves → agent auto-commits, pushes, creates PR
  → Engy polls PR status
  → CI failure → agent dispatched to fix, push, re-run
  → reviewer comments → agent addresses, pushes
  → all checks pass, approved → PR merged
Task group moves to Merged → session becomes inactive
Task group cleaned up → session data discarded
```

**Why sessions matter:** Without persistent sessions, feedback is disconnected. You'd comment on a diff, and a *new* agent instance would try to interpret your feedback without the context of why it made the original decision. With persistent sessions, the agent that receives your "this should use the cached value" comment is the same agent that chose not to use the cached value — it knows *why* it made that choice and can either explain its reasoning or make an informed revision.

Sessions are stored in SQLite as part of the project. They're deleted when the project is deleted — they're execution state, not knowledge.

### Cost Visibility

Agent sessions consume API tokens. Claude Code CLI (the terminal) tracks its own token usage natively. For async agent sessions (Mastra), Engy tracks token usage per session, per task group, and per project. This surfaces in the execution log (per-task token count), the project overview (project-level aggregate), and workspace settings (historical usage). The goal is awareness, not gatekeeping — engineers should know what things cost without needing to dig through API dashboards.

### Error Handling

Beyond agent-level failures (handled by the agent session's retry logic and the group controls), Engy handles infrastructure-level errors:

- **Network failures** — Agent sessions retry with backoff. If persistent, the session pauses and notifies the user. No silent failures.
- **API rate limits** — Sessions queue and wait. Multiple concurrent sessions respect shared rate limits via Mastra's orchestration.
- **Git conflicts between parallel groups** — Detected at commit time. The conflicting group stays in Review. Conflicts are resolved in the worktree (via terminal or VS Code), then re-committed.
- **Repo access issues** — Detected at worktree creation. Group fails to start with a clear error. User fixes access, restarts the group.
- **Database issues** — WAL mode for concurrent access. Backup strategy for recovery (see Storage Architecture).

The principle: every error either auto-recovers (with visibility in the execution log) or surfaces as a notification with clear next steps. No silent failures, no ambiguous states.

### Task Templates (via Claude Skills)

Repetitive workflows (e.g. "new microservice," "add API endpoint," "create React component") are handled through Claude Code skills, not a separate template system. A skill encapsulates the knowledge of how to create a spec, plan a project, or scaffold code for a particular pattern. When you say "create a new microservice spec," the spec-writing skill knows the structure, the questions to ask, and the context to pull. This keeps templates dynamic (skills improve over time, pull from system docs and memory) rather than static.

### Task Groups (the shippable unit)

A **Task Group** is a set of tasks that ship together as one PR. It's the unit of worktrees, branches, agent sessions, and parallelization. Task groups live in SQLite as part of the project.

Why this granularity:

- **Not per-project** — Projects can be long-lived (relatively). One worktree per project across 3 repos × 3 projects = 9 worktrees before writing any code.
- **Not per-task** — Too much churn. Sequential tasks need to see each other's changes. One task = one PR is too granular.
- **Per task group** — Maps to a PR. Tasks within a group see each other's commits. Worktree lifecycle matches the shippable unit. One agent session per group.

**Task group lifecycle:**

```text
Planned → Active → Review → PR Open → Merged → Cleaned Up
                ↕
             Paused
                ↓
             Stopped → (Restart) → Active
```

- **Planned:** Group exists in the plan. No worktree yet. Tasks are defined but not started.
- **Active:** Worktree created, branch created, agent session running. Tasks execute sequentially within the session. Diffs appear in the diff viewer as work progresses.
- **Paused:** Agent session suspended, worktree preserved, current task stays "in progress." Can resume with full context. Useful for reprioritizing or "I need to think about this."
- **Stopped:** Agent session killed, worktree preserved with current changes. Tasks revert to Planned. Can restart with a new session, optionally with notes ("use X approach instead") that become context for the new session. Useful for "this approach is wrong, start over."
- **Review:** All tasks in the group are complete. Diffs are in the diff viewer awaiting review. The user reviews, comments (feedback routes to the agent session), agent revises. On approval, the agent auto-commits with a contextual message, pushes, and creates a PR via `gh` (title and description generated from spec/plan/task context).
- **PR Open:** PR is live on the remote. Engy actively monitors: polls CI status, reviewer comments, and review state. On CI failure, the agent is dispatched to read logs, diagnose, fix, and push — autonomously for straightforward issues. Reviewer comments are pulled into the diff viewer and addressed by the agent. If the agent can't resolve something, it notifies the user. This is an active state, not a passive wait.
- **Merged:** PR merged (from Engy or the remote). Work is in the target branch.
- **Cleaned Up:** Worktree deleted, branch cleaned up (if merged). Agent session discarded. Terminal state.

**Group controls:** Every active group has controls: **Pause** (suspend session), **Stop** (kill session), **Resume** (resume paused session), **Restart** (create new session for stopped group). Controls are available from the project overview's active agents panel, the dependency graph, the swimlane board, the PR tab, and task detail views. Controls operate on the group level — pausing a group pauses the agent session, which stops the currently executing task.

**Execution visibility:** Each AI task within a group exposes an execution log — a real-time stream from the Mastra agent session showing what the agent is doing, tool calls, errors, retries, and resolution status. The log is accessible from the task detail view (Content | Log tabs). This gives three levels of zoom: project overview (which agents are running), dependency graph (which tasks are done/running/waiting), and task detail log (what the agent is actually doing right now).

**Failure handling:**

- If a task within a group fails validation, the group blocks. The failing task must be resolved (fixed or dropped) before the group can proceed — feedback through the diff viewer or terminal. You don't ship partial groups — the whole point of a group is that it's a coherent unit.
- If a task is dropped from an active group, the worktree continues with the remaining tasks. If all tasks are dropped, the group moves to Cleaned Up (no PR).
- If a commit has merge conflicts, the group stays in Review. Conflicts are resolved in the worktree (via the terminal) before committing.

**Cross-repo groups:** A group that touches multiple repos creates one worktree per repo and produces diffs in each. The diff viewer shows all diffs for the group together. The group isn't "done" until all repos are committed and pushed. Commits are coordinated — they should land together.

**Creation:** Task groups are created during milestone planning via the terminal. The planning skill proposes the grouping based on which tasks are logically coupled (shared branch, coherent PR). The user can adjust groupings in the terminal or via the project view UI. Groups can be reorganized before a group becomes Active — once work starts, the group is locked. If a task within a group is re-planned (task-level planning), the new tasks replace the original within the same group.

### Milestones

A **Milestone** is an organizational grouping of task groups within a project. It represents a meaningful checkpoint — "backend auth is done," "frontend is wired up."

**Milestone lifecycle:**

```text
Planned → Planning → Active → Complete
```

- **Planned:** Milestone exists with a rough scope description from project-level planning. No groups or tasks yet.
- **Planning:** The milestone is being decomposed into groups and tasks via its own planning loop (same skill, same terminal interaction as project-level planning). The planning agent has context from earlier milestones' outcomes.
- **Active:** Groups and tasks are defined. Task groups are executing.
- **Complete:** All task groups in the milestone are in Merged or Cleaned Up state.

Milestones can run in parallel when they're independent (no cross-milestone task dependencies). Milestone completion drives the dashboard progress indicators.

### Progressive Planning

Planning is not a single upfront phase — it's progressive. Each level of the hierarchy has its own plan loop, and detail is added just-in-time:

1. **Project planning** — Spec → milestones with rough scope. Defines the major chunks of work and their dependencies. No tasks yet.
2. **Milestone planning** — When a milestone is ready to start, it enters its own plan loop. The planning skill decomposes it into groups and tasks. This is when detailed work items are defined — with full context from any earlier milestones that have already completed.
3. **Task planning** (optional) — If a task turns out to be more complex than expected during execution, the agent or user can trigger a plan loop on it. The plan loop replaces the original task with the finer-grained tasks it produces — no sub-task hierarchy, the original task just dissolves into its decomposition. New tasks stay within the same group.

All three levels use the same planning skill, same terminal interaction, same iterate-and-refine flow. The only difference is the input scope and what gets produced.

**Why progressive:** You don't have enough context to plan Milestone 3's tasks until Milestones 1 and 2 are done. Code has changed, learnings have accumulated, the spec might have evolved. Detailed upfront planning for 50+ tasks is waste — half will change. Plan just-in-time, with maximum context.

### Project Views

A project's tasks can be viewed through multiple lenses, each useful at different stages:

**Dependency graph (primary view during execution).** A flowchart-style visualization showing tasks as nodes, dependencies as edges, and task groups as visual clusters. This is the execution monitoring view — it shows the critical path, what's running in parallel, what's blocked, and where the bottleneck is. Nodes are color-coded by status and distinguished by type (AI tasks vs human tasks render differently). Clicking a node opens task details in a side panel: for AI tasks, this includes the agent session's execution state, logs, and produced diffs. For human tasks, it's a description and a completion checkbox. This view pairs directly with notifications — "agent blocked on T150" links you to the graph with T150 highlighted.

**Eisenhower matrix (primary view for human tasks and personal prioritization).** The classic urgent/important quadrant grid. This view is most useful for two things: prioritizing human tasks within a project ("get API keys" is urgent-important, "update the README" is not-urgent-not-important) and managing unscoped workspace tasks (your personal todo list). During planning, it's also useful as a gut-check on the AI's prioritization — are we building the urgent-important stuff first?

**Swimlane board (milestone progress overview).** Lanes are milestones, cards are task groups. Each card shows the group's status (Planned → Active → Review → Merged → Cleaned Up) and its tasks. This is a compact progress view — at a glance you see which milestones are moving, which are stalled, and how much work remains in each. Less detailed than the dependency graph but easier to scan for overall project health.

All three views show the same underlying data from SQLite. The dependency graph is the default when you open a project. The others are tabs or toggles within the project view.

---

## Storage Architecture

### Knowledge in Files, Execution in Database

The fundamental split: **things that accumulate lasting value are files (git-tracked). Things that are transient execution state live in SQLite.**

```text
FILES (.engy/, git-tracked — permanent knowledge)
  ├── workspace.yaml          # repos (incl. subdirs), settings, config
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

**System docs** (`system/`) — Markdown files organized into `features/` (BDD-style behavior docs) and `technical/` (architecture and infrastructure), with `overview.md` as the index. Updated through the diff viewer when projects complete.

**Specs** (`specs/{slug}/`) — Directories containing `spec.md` plus a `context/` subdirectory with supporting research. Self-contained. Status tracked in `spec.md` frontmatter. Authored via the terminal.

**Shared docs** (`docs/*.md`) — Markdown files. Conventions, style guides, org knowledge.

**Permanent memories** (`memory/*.md`) — Markdown files with YAML frontmatter. The distilled learnings that survive project deletion. (Schema below.)

### Database Entities

**Projects** — Name/slug, status, timestamps, spec reference, `isDefault` flag. Regular projects are created when a spec is approved and deleted when completion finishes. The Default project (`isDefault: true`) is auto-created with the workspace and is permanent — it can't be deleted or completed.

**Milestones** — Title, project reference, status (Planned / Planning / Active / Complete), ordering, scope description.

**Task Groups** — Group name, milestone reference, status (Planned / Active / Paused / Stopped / Review / PR Open / Merged / Cleaned Up), repos list.

**Tasks** — Title, description, status, type (`ai` or `human`), milestone reference, group reference, dependencies, importance/urgency. Has nullable `projectId` and nullable `specId` — a task belongs to one scope: project tasks have `projectId` set (including the Default project), spec tasks have `specId` set. Default project tasks and spec tasks have no milestone or group reference (flat list with dependencies only). The planning agent sets the type at creation: pure execution work is `ai`, anything requiring human judgment or action is `human`.

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

### MCP Server (AI Access Layer)

The AI terminal (Claude Code) accesses Engy's data through an **MCP server**. This is the boundary between the AI and the application — it defines what the AI can read and how it interacts with execution state.

**Database operations (read/write via MCP):** All SQLite interactions go through MCP tools. Creating projects, updating task status, writing fleeting memories, querying tasks, searching memories — the AI does all of this via structured MCP tool calls. This gives us a clean API boundary, validation, and audit trail for every AI action against execution state.

**Document operations (read-only via MCP, write via filesystem):** System docs, specs, shared docs, and memories are readable through MCP tools (the AI can call `getDocument` to read a spec's content, for example). But when the AI needs to *edit* these files, it writes directly to the filesystem — no MCP intermediary. This is more efficient (no serialization overhead for file writes) and leverages Claude Code's native file manipulation capabilities.

The split mirrors the storage architecture:

| Content | Read | Write |
|---------|------|-------|
| SQLite (projects, tasks, memories) | MCP tools | MCP tools |
| Files (system docs, specs, shared docs) | MCP tools | Direct filesystem |
| ChromaDB (search) | MCP tools | Automatic (reindex) |

**Why this split:** Database writes need validation, transactions, and coordination (e.g., creating a task group with 5 tasks atomically). MCP tools provide this. File writes are simpler — write the file, done. Having the AI go through MCP to write a markdown file adds latency and complexity for no benefit. Claude Code already knows how to write files well.

MCP tools include:

- **Project management:** `createProject`, `getProject`, `updateProjectStatus`, `deleteProject`
- **Task management:** `createTask`, `updateTask`, `getTasks`, `getTasksByGroup`, `getTasksBySpec`
- **Memory:** `createFleetingMemory`, `promoteMemory`, `searchMemories`
- **Planning:** `createMilestone`, `planMilestone`, `createTaskGroup`, `replanTask`, `getPlan`
- **Search:** `search` (queries ChromaDB), `getDocument` (reads file content)
- **Workspace:** `getWorkspaceConfig`, `getRepos`

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
  → each task produces diffs (visible in diff viewer)
  → user reviews diffs, provides feedback → routes to agent session
  → agent revises → user approves
  → agent auto-commits, pushes, creates PR via gh
  → external PR comments pulled back → agent addresses
  → PR merged → worktree cleaned up
```

**Multi-repo task groups:**

```text
Task Group: "Wire refresh flow e2e"
  repos: [engy-api, engy-app]
  → worktree in each repo
  → agent session works across both
  → diffs from both repos appear together in diff viewer
  → user approves → agent auto-commits in each repo, coordinated
  → agent pushes, creates PRs for each repo
  → all PRs merged → all worktrees cleaned up
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
SPEC DRAFTING (proposed change — files)
  ↓
  ├── spec tasks created (research + preparation)
  ├── AI tasks: agent sessions research, produce context/ files
  ├── human tasks: manual research, conversations, decisions
  ├── user reviews context files, sends feedback → routes to agent sessions
  ├── spec text refined as research completes
  ↓
SPEC READY → REVIEWED → APPROVED
  ↓
  │  Terminal: user approves, triggers project creation
  ↓
PROJECT (created in SQLite from spec)
  ↓
  │  Terminal: planning skill decomposes into milestones (rough scope)
  │  User reviews/adjusts in terminal + project view
  ↓
MILESTONE PLANNING (progressive, per milestone when ready)
  ↓
  │  Terminal: planning skill decomposes milestone into groups → tasks
  │  Optionally: task-level plan loop replaces complex tasks with finer-grained ones
  ↓
EXECUTE (runner picks up task groups)
  ↓
  ├── agent sessions activate per task group
  ├── tasks execute sequentially within sessions
  ├── diffs flow to diff viewer as work progresses
  ├── user reviews diffs, comments route to agent sessions
  ├── agents revise, user approves
  ├── agent auto-commits, pushes, creates PR via gh
  ├── external PR comments pulled back → agent addresses feedback
  ├── PR merged
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
  Default:            3 active tasks
  Active Projects:
    auth-revamp     ██████░░░░ 60%  (3/5 milestones)
    ci-overhaul     ██░░░░░░░░ 20%  (1/5 milestones)
    plan-mode       █████████░ 90%  (4/5 milestones)

  Specs in Progress: 2
```

Progress is derived from milestones. A milestone is complete when all its task groups have reached Merged or Cleaned Up state. Project progress = completed milestones / total milestones. The Default project shows active task count instead of milestone progress (since it has no milestones).

At a glance: what's in flight, what's stalled, what's done. No "Archived: 147 projects" clutter — completed projects are gone. Their value lives in the system docs and memories. WIP limits become visible — if three projects are active and none are progressing, that's a signal to focus.

Clicking into any project from the dashboard opens the dependency graph view with the terminal already contextualized — ready to work. Clicking the Default project opens the Eisenhower matrix — your personal prioritization board for ambient work.

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
    overview.md               # the map — links to all sections
    features/                 # BDD-style behavior docs
      authentication.md
      task-management.md
      notifications.md
    technical/                # architecture and infrastructure
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

**ChromaDB rebuild cost.** Full reindex with embedding regeneration is the slowest recovery operation. Since it now only indexes files + current database content (not hundreds of archived task files), this should be significantly faster than a file-heavy architecture. But large memory collections with long content could still take time.

**Terminal skill boundaries.** The terminal powers the entire workflow, which means the quality of the experience depends heavily on the skills. Poorly designed skills create friction. The skill set needs to be comprehensive enough to cover the full SDD loop without forcing users to fall back to raw commands, but flexible enough that power users can drop to raw Claude Code when needed.
