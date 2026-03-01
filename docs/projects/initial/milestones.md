# Engy: Milestone Plan

Derived from the [initial vision spec](../../specs/initial/initial.vision.md). Sequenced for vertical MVPs — each milestone delivers something usable — on a foundation that minimizes rework.

**Key decisions:**
- Server/client split from day one
- Skills ship with their milestone (usable from own terminal before M4)
- Async agents are a late milestone with placeholder hooks throughout
- PR/CI monitoring is last — engineers handle that manually
- System docs bundle with memory (knowledge layer)

## Context Documents

Reference material that informs the full milestone sequence:

- [Filesystem Structure](../../specs/initial/context/filesystem.md) — canonical `.engy/` directory layout and the knowledge layer design philosophy
- [UI Design](../../specs/initial/context/ui-design.md) — global layout, page-by-page designs, and component specs across all milestones
- [SDD Workflow](../../specs/initial/context/sdd-workflow.md) — the full spec-driven development loop: spec → project → execute → complete

---

## M1: Foundation

**What ships:** The skeleton that everything builds on. Two running processes that talk to each other, with the data layer ready.

### Server (Next.js)

- App shell with routing (`/`, `/w/[workspace]`, `/w/[workspace]/specs`, etc.)
- SQLite database with full schema:
  - `workspaces` — name, slug, config
  - `projects` — name, slug, status, spec reference, `isDefault` flag
  - `milestones` — title, project ref, status, ordering, scope description
  - `task_groups` — name, milestone ref, status, repos list
  - `tasks` — title, description, status, type (ai/human), milestone ref, group ref, dependencies, importance/urgency, nullable `projectId`/`specId`
  - `agent_sessions` — session ID, task group ref, state, status
  - `fleeting_memories`, `project_memories` — working notes, project-scoped decisions
  - `plan_content` — milestone/task-level plans
  - `comments` — inline comments on documents, anchored to content ranges
- API routes for all CRUD operations (workspace, project, task, milestone, task group)
- `.engy/` directory initialization on workspace creation:
  - `workspace.yaml` (repos, config)
  - `system/` (empty, with `overview.md` placeholder)
  - `specs/`
  - `docs/`
  - `memory/`
- Configurable `.engy/` location (global setting, default: `~/.engy/`, can point to any path e.g. a `docs/` dir in an existing repo)

### Client (Node.js)

- WebSocket connection to server
- Basic git operations (branch info, status)
- Repo file watcher — detects code changes and notifies server

### MCP Server (hosted on Engy server)

- Exposes Engy data to Claude Code CLI (running on client) via remote MCP connection
- Read/write SQLite via MCP tools (projects, tasks, milestones, memories)
- Read/write `.engy/` files via MCP tools (specs, system docs, shared docs)
- Workspace config access

### UI

- Global layout shell (header with breadcrumbs, main content area, placeholder for terminal panel)
- Home page with workspace list
- "Create Workspace" flow (name, repo directories with optional monorepo subdirectory scoping)
- Navigation between workspace pages (empty states for tabs not yet implemented)

### What you can do after M1

Create a workspace, see it on the home page, navigate to its sub-pages (empty states). The data layer is ready for everything that follows. MCP server is live — Claude Code can query Engy data from your terminal.

---

## M2: Spec Authoring

**What ships:** The spec writing and browsing experience — the first real usable feature.

### UI

- Workspace **Specs tab** with tree view (left panel) reflecting `.engy/specs/` filesystem
- **Content editor** (right panel) — BlockNote-based rich markdown editor for `spec.md` and context files
- Spec lifecycle status display and transitions: Draft → Ready → Approved
- Context file browsing — expand spec directory to see `context/` files, click to view/edit
- **Inline comments** on documents:
  - Create, view, resolve, delete
  - Stored in SQLite, anchored to content ranges
  - Local annotation feature — no routing yet (that's M5)
- **Spec tasks** sub-tab:
  - Flat list with dependency visualization
  - Task status, type (AI/Human)
  - Task creation
- "New Spec" action — creates directory in `.engy/specs/`, initializes `spec.md` with frontmatter
- "New Task" on spec tasks — creates task record with `specId` set
- Vision spec support — display foundational specs that reference child specs

### Server

- Spec file CRUD (create directory, read/write `spec.md`, manage `context/` files)
- Comment CRUD (create, update, resolve, delete — linked to document + position)
- Spec task management (CRUD, dependency tracking, status updates)
- Spec lifecycle validation (can't move to Ready with incomplete tasks)

### Server

- File watcher on `.engy/specs/` — picks up external spec file changes (e.g. edits via VS Code on the server machine or mounted volume) and syncs to UI
- "Open in VS Code" button for spec files (works when server is local; remote setups use the content editor)

### Skills

- `engy:spec-assistant` — guided spec drafting, research task creation, context file generation. Works from user's own terminal (Engy terminal panel doesn't exist yet).

### What you can do after M2

Write specs in Engy's editor, organize context files, leave inline review comments, track spec research tasks. Use `engy:spec-assistant` from your terminal for AI-assisted drafting.

---

## M3: Project Planning

**What ships:** The spec-to-project transition and the full planning model with visual project views.

### UI

- **"Create Project"** action on approved specs — creates project in SQLite, links to spec, updates spec status to Active
- **Project page** with tabs: Overview, Tasks, Plan (Diffs and PRs tabs present but empty/disabled)
- **Project Overview tab:**
  - Project status, spec link, overall progress bar
  - Milestone list with status indicators (Planned, Planning, Active, Complete)
  - "Plan Milestone" action on milestones ready for planning
- **Project Tasks tab** with three view toggles:
  - **Dependency graph** (default) — tasks as nodes, dependencies as edges, task groups as visual clusters, color-coded by status, click for task detail
  - **Swimlane board** — milestone lanes, task group cards with status
  - **Eisenhower matrix** — urgent/important quadrants
- **Task detail panel** (slide-out):
  - Description, dependencies, status, type (AI/Human)
  - Milestone, group assignment
  - Importance/urgency
- **Plan tab** — view/edit plan content per milestone (stored in SQLite)
- Milestone management — create, reorder, status transitions (Planned → Planning → Active → Complete)
- Task group management — create groups within milestones, assign tasks, display group status
- Task CRUD — create under milestones, set dependencies, assign to groups
- **Default project** — workspace Tasks tab using Eisenhower matrix, flat task list with dependencies, no milestones/groups
- **Workspace Overview tab** — project cards with progress bars, default project summary

### Server

- Project lifecycle management (Planning → Active → Completing → Archived)
- Milestone CRUD with ordering and status transitions
- Task group CRUD with status tracking
- Task dependency validation (cycle detection)
- Progressive planning support — milestone-level plan content storage

### Skills

- `engy:project-assistant` — milestone planning, group creation, task decomposition from spec
- `engy:workspace-assistant` — quick bugs, one-offs on default project
- Planning skill — guided progressive planning loops (project → milestone → groups/tasks)

### What you can do after M3

Approve a spec, create a project, plan milestones, create task groups, decompose into tasks with dependencies, visualize execution plans in three views. Manage ambient work in the default project.

---

## M4: Terminal Integration

**What ships:** The Claude Code CLI terminal panel inside Engy — the action layer.

### UI

- **Terminal panel** (right side of layout):
  - xterm.js terminal emulator
  - Tab-based — multiple terminals open simultaneously
  - Tab metadata labels showing scope (e.g. "spec: auth-revamp", "project: engy")
  - Vertical/horizontal splits for side-by-side terminal work
  - Drag-resizable left edge
  - Collapsible (keyboard shortcut + toggle button)
- **Context-scoped terminal auto-start:**
  - Spec page → scoped to `specs/{slug}/`, starts `engy:spec-assistant`
  - Project page → scoped to project's primary repo, starts `engy:project-assistant`
  - Default project / workspace Tasks → scoped to workspace root, starts `engy:workspace-assistant`
  - Diffs tab → scoped to task group's worktree, no special agent (CLI with diff context injected)
  - Docs page → scoped to `system/` or `docs/`, starts `engy:sysdoc-assistant` (placeholder until M7)
- **Scope persistence** — open terminals keep their scope when navigating pages
- **New terminal** — opens with scope matching current page

### Client

- Claude Code CLI process management — spawn, kill, resize
- WebSocket bridge between xterm frontend and CLI process on client machine
- Context injection — pass working directory, agent name, and scope metadata when spawning
- Terminal session persistence across page navigation

### Server

- Terminal session registry (which terminals are open, their scope metadata)
- WebSocket relay for terminal I/O between browser and client

### Skills

All previously shipped skills (`spec-assistant`, `project-assistant`, `workspace-assistant`, planning skill) now auto-start in the terminal panel. The skill framework is already working from M2-M3 — M4 brings it into the UI.

### What you can do after M4

Open terminal panels scoped to any page context. Auto-start the right skill. Run multiple terminals side by side. The app is now a two-panel experience: visual UI for state, terminal for action.

---

## M5: Diff Viewer + Review

**What ships:** Code review inside Engy with the unified feedback model.

### UI

- **Project Diffs tab** with three view modes:
  - **Latest Changes** (default) — pending review, file tree + diff view
  - **Commit History** — list of commits on the group's branch, click for individual diffs
  - **Branch Diff** — all changes vs `origin/main` (the "what will this PR look like" view)
- **Task group selector** — choose which group's diffs to view (hidden if only one group has diffs)
- **Line-level commenting** on diffs — click a line to add a comment
- **Review actions** (top-right):
  - **Approve** — triggers pre-commit gate → auto-commit flow
  - **Send Feedback** — batches all comments into structured markdown payload, routes to terminal session or agent session
- **Document feedback routing** — inline comments from M2 now gain the approve/send-feedback flow. Comments on specs and docs batch and route to the active terminal.
- **Pre-commit gate** — per-repo configured command (from workspace settings) runs before committing. Pass/fail status displayed. On failure, surfaces errors for the agent/user to fix.

### Server

- Diff computation (working tree changes, commit diffs, branch diffs)
- Comment storage linked to diff hunks (file, line range)
- Feedback payload construction (structured markdown with file/line references)
- Pre-commit gate execution orchestration (triggers client to run command)

### Client

- Git diff operations (working tree, between commits, branch comparison)
- Pre-commit command execution in worktree
- Feedback routing — deliver structured payload to active terminal session

### What you can do after M5

Review code diffs inside Engy, leave line-level comments, approve or send batched feedback. Pre-commit gates enforce quality. The review model works for both diffs and documents.

---

## M6: Execution Engine

**What ships:** Worktree management, task execution lifecycle, auto-commit, push, and PR creation.

### UI

- **Task group lifecycle controls** on project overview and task detail:
  - Start (creates worktree, activates group)
  - Pause / Resume (suspend/resume session, preserve worktree)
  - Stop (kill session, option to restart with notes)
  - Complete (manually close group, skip PR flow)
- **Task group status indicators:** Planned → Active → Review → PR Open → Merged → Cleaned Up
- **Active agent panel** on project overview — which groups are running, current task, elapsed time, controls
- **Task execution status** — in-progress indicator on dependency graph nodes
- **Auto-commit on approve** — after pre-commit gate passes, agent commits with message generated from task/plan context
- **Push + PR creation** — after commit, push branch and create PR via `gh` CLI. PR link displayed on task group card.

### Client

- **Worktree management:**
  - Create worktree per repo when group activates
  - Branch naming: `{project-slug}/{group-name}`
  - Worktree cleanup on group completion (Merged or Cleaned Up)
  - Cross-repo groups: one worktree per repo in the group's repos list
- **Task execution coordination:**
  - Sequential task execution within a group
  - Status updates back to server
- **Git operations:**
  - Auto-commit (stage files, generate message, commit)
  - Push branch to remote
  - PR creation via `gh pr create`
- **"Open in VS Code"** for worktree paths

### Server

- Task group state machine with transition validation
- Worktree registry — track active worktrees per group per repo
- Execution status broadcasting (WebSocket updates to UI)

### Skills

- All existing skills gain worktree awareness — agents know which worktree they're operating in

### What you can do after M6

Start task groups, see worktrees created, execute tasks, review diffs, approve, auto-commit, push, and create PRs. The full execution loop works (manually driven, with terminal for AI assistance). Pause/stop/resume groups.

---

## M7: Knowledge Layer

**What ships:** System docs, shared docs, memory architecture, and search — the learning feedback loop.

### UI

- **Workspace Docs tab** — tree + editor layout (same pattern as Specs tab):
  - `system/` tree with `features/` and `technical/` subsections
  - `docs/` tree for shared docs (conventions, guides)
  - Content editor with inline comments
  - "New Document" action
- **Workspace Memory tab:**
  - Memory browser (left panel) — list with filter (type, scope, tags) and search
  - Memory detail (right panel) — full content in editor, metadata display (type, scope, confidence, source, tags, linked memories)
  - Manual memory creation and editing
- **Memory promotion UI** — review fleeting memories, promote to permanent (write to `.engy/memory/`)
- **Memory review** — periodic surfacing of recent unpromoted candidates so users can catch missed insights
- **Search integration:**
  - ChromaDB indexing of all content (specs, docs, tasks, memories)
  - Search bar results grouped by content type
  - Terminal search via MCP tools
- **Project completion flow:**
  - Memory distillation — evaluate project memories for promotion
  - System doc update proposals — agent proposes diffs, appear in diff viewer for review
  - Archive project (compact, mark read-only)
- **Bootstrap skill UI trigger** — "Bootstrap System Docs" action for new workspaces

### Server

- ChromaDB integration — index all files and active DB content
- `engy reindex` — rebuild ChromaDB from `.engy/` files
- `engy validate` — broken links, schema compliance, orphaned content
- Memory CRUD (fleeting in SQLite, permanent as files in `.engy/memory/`)
- Memory promotion pipeline (evaluate, deduplicate, write to files)
- Search API — hybrid ChromaDB vector search + SQLite structured queries

### Skills

- `engy:sysdoc-assistant` — editing system docs (fully functional now, was placeholder in M4)
- Bootstrap skill — reads codebase via client connection, proposes initial system docs (written to `.engy/system/` on server)
- Completion skill — memory distillation, system doc update proposals

### Context injection

- Agents receive memories in order: project → workspace → repo (filtered by `repo` field)
- Planning agents see: system docs + workspace memories + repo memories

### What you can do after M7

Browse and edit system docs and shared docs. Manage memories (create, promote, search). Search across all content types. Complete projects with memory distillation and system doc updates. Bootstrap system docs for new workspaces. The full SDD knowledge feedback loop is closed.

---

## M8: Workspace Polish

**What ships:** Dashboard, notifications, settings, and UX refinements that make the whole experience cohesive.

### UI

- **Home page refinement:**
  - Workspace cards with active project count, progress bars, agent status summary, specs in progress
  - Cross-workspace summary
- **Workspace Overview tab refinement:**
  - Active projects with milestone progress, agent status (running/blocked/idle)
  - Specs in progress with research task progress
  - Recent activity feed (reverse-chronological notable events)
- **Notifications:**
  - Notification icon (🔔) with unread badge
  - Notification panel (slide-out or dropdown)
  - Triggers: agent needs input, task group ready for review, PR review received, milestone completed, project ready for completion, system doc update proposed, validation warnings
  - Each notification links to relevant view with terminal contextualized
- **Settings hierarchy:**
  - Global settings (Home page ⚙️): Engy data directory, default AI model, notification defaults, appearance
  - Workspace settings (workspace page ⚙️): repo directories with pre-commit commands, agent config (model, tools, MCP servers), notification overrides, terminal defaults
  - Context-aware settings icon — opens appropriate level based on current page
- **Global search polish:**
  - Search bar on every page
  - Results grouped by type with navigation
  - Keyboard shortcut to focus
- **Cost visibility:**
  - Token usage per session, group, project
  - Surfaced in execution logs, project overview, workspace settings

### Server

- Notification system (event triggers, storage, read/unread state)
- Settings storage and hierarchy resolution
- Activity feed aggregation
- Usage tracking per agent session

### What you can do after M8

Full dashboard visibility across workspaces. Notifications keep you aware of what needs attention. Settings are organized and context-aware. The app feels polished and complete (minus automation).

---

## M9: Async Agents

**What ships:** Mastra integration for autonomous background agent execution.

### Architecture

- **Mastra runtime** on the client — agent lifecycle management, tool coordination, workflows
- **Agent sessions** — persistent, resumable instances tied to task groups or spec tasks
  - Full context injection (spec, plan, tasks, memories, system docs)
  - Worktree access
  - Stable session ID for feedback routing
  - Crash recovery — worktree preserved, session resumable from SQLite

### UI

- **Agent execution visibility:**
  - Project overview: which agents are running, current task, status
  - Task detail Log tab: real-time execution stream from agent session (tool calls, errors, retries)
  - Three zoom levels: project overview → dependency graph → task detail log
- **Agent controls at group level:**
  - Start (activates agent session)
  - Pause / Resume (suspend/resume Mastra session)
  - Stop / Restart (with notes for context)
- **Auto-start mode** (workspace setting) — groups automatically activate when dependencies resolve, useful for hands-off execution of well-planned milestones
- **Feedback routing to agent sessions:**
  - "Send Feedback" on diffs/docs routes structured payload to the originating agent session
  - Mastra resumes session with feedback as new context
  - Same agent that made the decision receives the feedback

### Client (Mastra integration)

- Agent session management (create, pause, resume, stop, restart)
- Session state persistence in SQLite
- Tool registration (filesystem access, git operations, MCP tools)
- Memory emission during execution (fleeting memories to SQLite)
- Synthesis at task group boundaries (triage fleeting memories against permanent)

### Server

- Agent session registry and status broadcasting
- Execution log streaming (WebSocket to UI)
- Feedback payload delivery to client for agent session injection

### Placeholder hooks (already in place from earlier milestones)

- Task group state machine already supports agent-driven transitions
- Feedback routing architecture already built in M5
- Worktree management already built in M6
- Memory pipeline already built in M7

### What you can do after M9

Kick off task groups as autonomous agent sessions. Agents execute tasks, produce diffs, and surface results for review. Feedback routes back to the same agent session. Agents crash-recover. The system works without you being present.

---

## M10: PR/CI Monitoring

**What ships:** Automated monitoring of open PRs — CI status, reviewer comment triage, and auto-fix dispatch.

### UI

- **Project PRs tab:**
  - List of open PRs for this project (across repos)
  - CI status per PR (passing, failing, pending)
  - Reviewer comments pulled into Engy
- **CI failure handling:**
  - CI failure notification
  - Agent auto-dispatched for mechanical fixes (lint, type errors, missing deps)
  - New diffs appear for review after agent fixes
  - Unresolvable failures notify user
- **Reviewer comment triage:**
  - PR reviewer comments displayed in diff viewer context
  - Select which comments to address
  - "Fix Selected" dispatches agent with selected comments as context
  - Unselected comments can be responded to manually or dismissed

### Client

- GitHub PR polling via `gh` CLI (status, checks, reviews, comments)
- CI failure diagnosis and auto-fix agent dispatch
- Selective comment fix execution

### Server

- PR status tracking and polling coordination
- CI status change detection and notification triggers
- Reviewer comment storage and triage state

### What you can do after M10

Open PRs are monitored automatically. CI failures trigger agent fixes. Reviewer comments are pulled back into Engy for triage — pick which to fix, agent handles the rest. The full PR lifecycle is managed inside Engy.

---

## Milestone Dependencies

```text
M1 ──→ M2 ──→ M3 ──→ M4 ──→ M5 ──→ M6 ──┐
                                            ├──→ M8
                                    M7 ─────┘

M9 depends on: M6 (worktrees), M7 (memory), M5 (feedback routing)
M10 depends on: M6 (PR creation), M9 (agent dispatch)
```

Note: M7 (Knowledge Layer) can potentially be worked on in parallel with M5-M6 since it's primarily about the knowledge/memory subsystem. M8 (Workspace Polish) depends on all prior features existing to polish.

---

## What's NOT in these milestones

- Multi-user / collaboration (explicitly single-user-first)
- GitLab / Bitbucket support (GitHub only via `gh`)
- Mobile / responsive design
- Self-hosting distribution / packaging
- Cross-workspace project coordination (manual for now)
