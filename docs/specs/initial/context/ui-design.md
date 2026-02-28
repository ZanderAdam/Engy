# Engy UI Design

## Global Layout

Every page in Engy shares the same shell:

```text
┌──────────────────────────────────────────────────────────────────────┐
│  [Breadcrumb: Home > engy > auth-revamp > Tasks]   🔍  🔔  ⚙️      │
├──────────────────────────────────────────┬───────────────────────────┤
│                                          │                           │
│   Main Content Area                      │   Terminal Panel          │
│                                          │   (Claude Code CLI        │
│   Changes based on current page.         │    in xterm)              │
│   Houses tabs, editors, viewers,         │                           │
│   graphs — all primary content.          │   Persists across page    │
│                                          │   navigation within a     │
│                                          │   context. Context-aware  │
│                                          │   — knows what you're     │
│                                          │   looking at.             │
│                                          │                           │
│                                          │   Resizable (drag edge).  │
│                                          │   Collapsible.            │
│                                          │                           │
└──────────────────────────────────────────┴───────────────────────────┘
```

### Header (persistent)

- **Breadcrumbs** — navigation trail showing current location. Clickable at every level. Doubles as context indicator for the terminal.
- **Global search** (🔍) — search bar, always available. Results grouped by type: docs, specs, tasks, memories. Clicking a result navigates to the right view.
- **Notifications** (🔔) — badge with unread count. Opens notification panel (slide-out or dropdown). Each notification links to the relevant view.
- **Settings** (⚙️) — workspace settings, repos, configuration.

### Terminal Panel (persistent)

The right panel hosts Claude Code CLI in xterm. Key behaviors:

- **Persists across navigation** within a related context. Opening the terminal at project home and navigating to tasks keeps the same terminal session.
- **Context injection updates** as you navigate. The CLI session stays alive, but it knows when you've moved from "project overview" to "task T150 detail." Context flows from the main content area to the terminal automatically.
- **Resizable** — drag the left edge to make the terminal wider/narrower.
- **Collapsible** — hide the terminal to give the main content full width. Toggle button in the header or a keyboard shortcut.

### Top-Right Action Bar

All primary actions live in the **top-right of the main content area** — always the same position regardless of the page. Actions are minimal icon buttons with descriptions on hover. The actions shown adapt to the current context:

**Create actions ("+"):**

- On Docs tab → "New Document" (system doc or shared doc)
- On Specs tab → "New Spec"
- On Tasks tab → "New Task" (scoped to current project or spec)
- On Project overview → "New Task," "New Task Group," "New Milestone"

**Document feedback ("Send Feedback" icon):**

- Appears on the content editor when there are pending inline comments on an agent-produced document (spec drafts, context files). Clicking collects all comments into a structured markdown payload (with section references and line context) and routes it to the agent session that produced the document. Comments clear after sending. The agent receives feedback like:

```markdown
## Feedback on auth-revamp/spec.md

### On "Token Refresh Strategy" (line 42-58)
This needs more detail on error handling for expired refresh tokens.

### On "Rate Limiting" (line 73)
We should use sliding window, not fixed window.

### General
Missing a section on logout/token revocation.
```

**Diff actions:**

- On Diffs tab (Latest Changes) → "Approve," "Request Changes"
- On Diffs tab (Branch Diff, group in Review) → "Create PR"

**Planning actions:**

- On Project overview (milestone ready to plan) → "Plan Milestone"

Consistent placement means muscle memory — you always know where to look. The bar shows only the actions relevant to the current view. Simple entities (tasks) can use a quick inline form. Complex entities (specs, milestones) route to the terminal for the appropriate skill.

---

## Page: Home

The entry point. Shows all workspaces and a cross-workspace summary. The header has global settings (⚙️), notifications (🔔), and search (🔍).

**"+ New Workspace" button** at the bottom of the workspace list. Clicking opens a creation flow: name the workspace, select one or more repo directories (or subdirectories for monorepo scoping), and Engy initializes the `.engy/` directory and creates the Default project.

**Global settings** (⚙️ in the Home header) — Engy data directory, default AI model, notification defaults, appearance.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Home                                                 🔍  🔔  ⚙️│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Workspaces                                                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  engy                                                    │    │
│  │  Default: 3 active tasks                                 │    │
│  │  Projects:                                               │    │
│  │    auth-revamp     ██████░░░░ 60%   2 agents running     │    │
│  │    ci-overhaul     ██░░░░░░░░ 20%   1 agent blocked      │    │
│  │    plan-mode       █████████░ 90%   idle                  │    │
│  │  Specs in Progress: 2                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  personal-site                                           │    │
│  │  Default: 1 active task                                  │    │
│  │  Projects: none active                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  [+ New Workspace]                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each workspace card shows:

- Workspace name
- Default project active task count
- Active projects with milestone progress bars, agent status (running/blocked/idle)
- Specs in progress count

Workspaces ordered by last interaction. Clicking a workspace navigates to the Workspace view. Clicking a specific project within the card navigates directly to that project.

---

## Page: Workspace

Entered by clicking a workspace from Home. Top-level tabs organize workspace content.

**Workspace settings** (⚙️ in the workspace header) — repo directories (add/remove, monorepo subdirectory scoping), pre-commit command (e.g. `yarn blt` — enforced gate before all commits), agent configuration (model, tools, MCP servers), notification overrides, terminal defaults. The settings icon is context-aware: on the Home page it opens global settings, on a workspace page it opens that workspace's settings.

### Tabs

```text
[ Overview | Specs | Docs | Tasks | Memory ]
```

### Tab: Overview

The workspace dashboard. Shows all projects and their health at a glance.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Home > engy                                          🔍  🔔  ⚙️│
├─────────────────────────────────────────────────────────────────┤
│  [ Overview | Specs | Docs | Tasks | Memory ]                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Default Project                                    [View →]    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  3 active tasks · 12 completed this week                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Active Projects                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  auth-revamp         ██████░░░░ 60%                      │    │
│  │  3/5 milestones · 2 agents running · 1 PR open           │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  ci-overhaul         ██░░░░░░░░ 20%                      │    │
│  │  1/5 milestones · 1 agent blocked (needs input)          │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  plan-mode           █████████░ 90%                      │    │
│  │  4/5 milestones · idle · 2 PRs merged today              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Specs in Progress                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  data-pipeline-v2    Draft    3/5 research tasks done    │    │
│  │  mobile-auth         Ready    awaiting review            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Recent Activity                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  10:42  auth-revamp: PR #47 CI passed, merged            │    │
│  │  10:30  ci-overhaul: Agent blocked on T89 (needs input)  │    │
│  │  10:15  plan-mode: Task group "parser-v2" review ready   │    │
│  │  09:50  Default: Completed "fix typo in README"          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Project cards show: name, milestone progress bar, milestone fraction, agent status summary, PR count. Clicking a project navigates to the Project view.

Spec cards show: name, lifecycle status, research task progress. Clicking a spec navigates to the Spec detail view.

Recent activity is a reverse-chronological feed of notable events across all projects (PR merged, agent blocked, review ready, task completed).

### Tab: Specs

The spec browser. Tree view on left, content editor on right.

Left panel: spec tree reflecting the filesystem structure. Vision specs, numbered child specs, each expandable to show `spec.md` and `context/` files. Clicking a spec selects it and populates the right panel.

Right panel has sub-tabs:

- **Content** — the spec and context files in the content editor (BlockNote-style rich markdown). Clicking a file in the left tree opens it here. Inline comment support for reviews. When comments are pending on an agent-produced document, the "Send Feedback" action appears in the top-right action bar — clicking it collects all comments as structured markdown and routes them to the agent session that drafted the document.
- **Tasks** — the spec's research tasks. Dependency graph and flat list views. Task status, type (AI/Human), agent session status. Task creation via the create button or terminal.

Spec lifecycle actions appear as buttons or status indicators: "Mark Ready," "Approve," "Create Project →" (which navigates to the new project).

```text
┌──────────────────────┬──────────────────────────────────────────┐
│  Spec Tree           │  [Content ▼]  [Tasks]                    │
│                      │                                          │
│  ▼ initial/          │  # Auth Revamp Spec                      │
│    spec.md        ←  │                                          │
│    ▼ context/        │  Status: Draft                           │
│      brainstorm.md   │                                          │
│      oauth-research  │  ## Problem                              │
│      benchmarks.md   │  Current auth flow has three issues...   │
│                      │                                          │
│  ▼ 1_storage-layer/  │  ## Proposed Solution                    │
│    spec.md           │  Migrate to JWT with refresh rotation... │
│    ▼ context/        │                                          │
│      ...             │  [Inline comments visible in margin]     │
│                      │                                          │
│  ▶ 2_workspace-model/│  [Mark Ready]  [Create Project →]        │
│  ▶ 3_interaction/    │                                          │
│                      │                                          │
│  [+ New Spec]        │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

Tasks sub-tab:

```text
┌──────────────────────┬──────────────────────────────────────────┐
│  Spec Tree           │  [Content]  [Tasks ▼]                    │
│                      │                                          │
│  ▼ initial/          │  [Dependency Graph ▼]  [List]            │
│    spec.md           │                                          │
│    ▼ context/        │  ✅ Research OAuth providers       [AI]  │
│      brainstorm.md   │    └→ ⏳ Benchmark current latency [AI]  │
│      oauth-research  │  ☐  Talk to backend team          [Human]│
│      benchmarks.md   │    └→ ☐  Review competitor flows  [AI]  │
│                      │                                          │
│  ▶ 1_storage-layer/  │                                          │
│  ▶ 2_workspace-model/│  [+ New Task]                            │
│  ▶ 3_interaction/    │                                          │
│                      │                                          │
│  [+ New Spec]        │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

### Tab: Docs

System docs and shared docs. Same tree + editor layout as Specs.

```text
┌──────────────────────┬──────────────────────────────────────────┐
│  Doc Tree            │  Content Editor                          │
│                      │                                          │
│  ▼ system/           │  # Authentication                        │
│    overview.md       │                                          │
│    ▼ features/       │  Auth uses JWT with refresh token        │
│      authentication  │  rotation. Tokens expire after 15min...  │
│      task-mgmt       │                                          │
│      notifications   │  ## Refresh Flow                         │
│    ▼ technical/      │  1. Client sends expired access token    │
│      api.md          │  2. Server validates refresh token...    │
│      database.md     │                                          │
│      deployment.md   │  [Inline comments for review]            │
│                      │                                          │
│  ▼ docs/             │                                          │
│    coding-conventions│                                          │
│    api-style-guide   │                                          │
│                      │                                          │
│  [+ New Document]    │                                          │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

System docs grouped under `system/` with `features/` and `technical/` subsections. Shared docs under `docs/`. Same content editor with inline comments. System doc edits can be made directly here or proposed via the project completion workflow (which surfaces in the diff viewer).

### Tab: Memory

Browse and search promoted workspace memories.

```text
┌──────────────────────┬──────────────────────────────────────────┐
│  Memory Browser      │  Memory Detail                           │
│                      │                                          │
│  Filter: [All ▼]     │  M500: JWT rotation with grace period    │
│  Search: [________]  │                                          │
│                      │  Type: pattern                           │
│  M502 shared-lib...  │  Scope: repo (engy-api)                  │
│  M501 api-error...   │  Confidence: 0.9                         │
│  M500 jwt-rotation ← │  Source: auth-revamp                     │
│  M499 rate-limit...  │  Tags: auth, jwt, tokens                 │
│  M498 db-migration.. │                                          │
│  ...                 │  When implementing JWT refresh token      │
│                      │  rotation, always include a grace period  │
│                      │  (default 30s) for the old token...      │
│                      │                                          │
│                      │  Linked: M480, M495                      │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

Left panel: list of memories with filter (by type, scope, tags) and search. Right panel: selected memory detail in the content editor, editable.

### Tab: Tasks

Default project tasks — the workspace scratchpad. Eisenhower matrix as the primary view.

```text
┌─────────────────────────────────────────────────────────────────┐
│  [Eisenhower Matrix ▼]  [Dependency Graph]  [List]              │
├────────────────────────────────┬────────────────────────────────┤
│  URGENT + IMPORTANT            │  NOT URGENT + IMPORTANT        │
│                                │                                │
│  ☐ Fix prod auth bug    [AI]  │  ☐ Refactor error handling [AI]│
│  ☐ Get API keys         [Human]│  ☐ Update README          [Human]│
│                                │                                │
├────────────────────────────────┬────────────────────────────────┤
│  URGENT + NOT IMPORTANT        │  NOT URGENT + NOT IMPORTANT    │
│                                │                                │
│  ☐ Reply to vendor email[Human]│  ☐ Clean up test fixtures [AI]│
│                                │                                │
├────────────────────────────────┴────────────────────────────────┤
│                                                                 │
│  [+ New Task]                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Three view toggles: Eisenhower matrix (default), dependency graph, and flat list. Same views as project tasks, just operating on the Default project's task set.

---

## Page: Project

Entered by clicking a project from the workspace overview (or from a spec's "Create Project →" action). Has its own tab set.

### Tabs

```text
[ Overview | Tasks | Diffs | PRs | Plan ]
```

### Tab: Overview

Project health at a glance.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Home > engy > auth-revamp                            🔍  🔔  ⚙️│
├─────────────────────────────────────────────────────────────────┤
│  [ Overview | Tasks | Diffs | PRs | Plan ]                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Status: Active              Spec: auth-revamp/spec.md          │
│  Progress: ██████░░░░ 60%    Started: Feb 20                    │
│                                                                 │
│  Milestones                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ✅ M1: Backend auth endpoints        3/3 groups merged │    │
│  │  ✅ M2: Token refresh flow            2/2 groups merged │    │
│  │  ⏳ M3: Frontend auth hooks           1/3 groups done   │    │
│  │  📋 M4: Integration tests            [Plan Milestone]   │    │
│  │  ☐  M5: Deployment + migration        Planned            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Active Agents                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Group "auth-hook-component"  → executing T165 (AI)      │    │
│  │    Running for 4m · engy-app worktree   [⏸ Pause] [⏹ Stop]│    │
│  │  Group "auth-context-provider" → blocked T170 (AI)       │    │
│  │    Needs input: "Which state lib?"      [⏹ Stop] [▶ Resume]│    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Recent Activity                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  10:42  Group "token-refresh" PR #47 merged              │    │
│  │  10:30  T170 blocked — agent needs input                 │    │
│  │  10:15  Group "auth-hook-component" review ready         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Shows: project status, spec link, overall progress, milestone breakdown, active agent panel (which groups are running, what task, status, controls), recent activity feed scoped to this project.

**Milestone states are visible:** Completed milestones show group counts. Active milestones show progress. Milestones ready for planning show a "Plan Milestone" action (triggers the planning loop in the terminal). Planned milestones (not yet ready) show as dimmed. This makes progressive planning visible — you see which milestones need planning next.

The agent status panel is key — it answers "what's happening right now?" at a glance. Blocked agents surface prominently because they need your input. Group controls (pause/stop/resume) are inline on each running group.

### Tab: Tasks

The execution monitoring hub. Three view options.

**Dependency Graph (default):**

```text
┌─────────────────────────────────────────────────────────────────┐
│  [Dependency Graph ▼]  [Eisenhower Matrix]  [Swimlane]          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐     ┌─────────┐                                   │
│  │  T150   │────▶│  T152   │──┐                                 │
│  │ ✅ done │     │ ⏳ run  │  │    ┌─────────┐                  │
│  └─────────┘     └─────────┘  ├───▶│  T155   │                  │
│  ┌─────────┐     ┌─────────┐  │    │ ☐ wait  │                  │
│  │  T151   │────▶│  T153   │──┘    └─────────┘                  │
│  │ ✅ done │     │ ⏳ run  │                                    │
│  └─────────┘     └─────────┘                                    │
│                                     ┌─────────┐                 │
│  ┌─────────┐                   ┌───▶│  T158   │                 │
│  │  T156   │───────────────────┘    │ ☐ wait  │                 │
│  │ 🔴block │  [Human]               └─────────┘                 │
│  └─────────┘                                                    │
│                                                                 │
│  Legend: ✅ Done  ⏳ Running  ☐ Waiting  🔴 Blocked             │
│  Task groups shown as visual clusters (shared background)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Flowchart of tasks. Nodes color-coded by status, shaped differently for AI vs human tasks. Dependencies as directed edges. Task groups as visual clusters (shared background color or border). Clicking a node opens a side panel with task detail:

- **AI tasks:** agent session status, execution logs, produced diffs, link to diff viewer
- **Human tasks:** description, completion checkbox

**Swimlane Board:**

```text
┌─────────────────────────────────────────────────────────────────┐
│  [Dependency Graph]  [Eisenhower Matrix]  [Swimlane ▼]          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  M1: Backend endpoints ✅                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ add-      │  │ validate │  │ error-   │                      │
│  │ endpoints │  │ -schema  │  │ handling │                      │
│  │ ✅ Merged │  │ ✅ Merged │  │ ✅ Merged │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
│                                                                 │
│  M3: Frontend hooks ⏳                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ auth-hook│  │ context- │  │ logout-  │                      │
│  │ component│  │ provider │  │ flow     │                      │
│  │ ⏳Review │  │ 🔴Blocked│  │ ☐Planned │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Lanes are milestones. Cards are task groups with status. Compact progress overview.

**Eisenhower Matrix:** Same as workspace Tasks tab, but scoped to this project. Useful for human tasks and prioritization during planning.

### Task Detail Panel

Clicking any task (from the dependency graph, swimlane card, or any list view) opens a detail panel — a slide-out from the right or an expanded inline view.

**Human tasks** show a simple detail view: description, dependencies, importance/urgency, completion checkbox.

**AI tasks** have two sub-tabs: **Content** and **Log**.

```text
┌─────────────────────────────────────────────────────────────────┐
│  T152: Validate auth schema    [AI]  ⏳ Running (3m)            │
│  Group: validate-schema                                         │
│  Group controls:                       [⏸ Pause] [⏹ Stop]      │
├─────────────────────────────────────────────────────────────────┤
│  [Content ▼]  [Log]                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Description:                                                   │
│  Add JSON schema validation for all auth endpoints.             │
│  Validate request bodies, query params, and response shapes.    │
│                                                                 │
│  Dependencies: T150 (✅), T151 (✅)                               │
│  Milestone: M1 · Group: validate-schema                         │
│  Importance: Important · Urgency: Urgent                        │
│                                                                 │
│  Diffs: 3 files changed                       [View in Diffs →] │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Log sub-tab** — real-time execution stream from the Mastra agent session. Shows what the agent is doing, tool calls, errors, retries, and resolution status.

```text
┌─────────────────────────────────────────────────────────────────┐
│  T152: Validate auth schema    [AI]  ⏳ Running (3m)            │
│  Group: validate-schema                                         │
│  Group controls:                       [⏸ Pause] [⏹ Stop]      │
├─────────────────────────────────────────────────────────────────┤
│  [Content]  [Log ▼]                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  10:42:15  Reading spec context...                              │
│  10:42:18  Analyzing existing endpoint schemas...               │
│  10:42:25  Tool: readFile src/routes/auth.ts                    │
│  10:42:30  Creating validation middleware...                    │
│  10:42:38  Tool: writeFile src/middleware/validate.ts            │
│  10:42:45  Writing tests for schema validation...               │
│  10:43:02  ⚠️ Test failure: POST /auth/refresh missing field    │
│  10:43:05  Diagnosing... schema definition out of sync          │
│  10:43:08  Fixing schema definition...                          │
│  10:43:12  Re-running tests...                                  │
│  10:43:20  ✅ All tests passing (12/12)                          │
│  10:43:25  Producing diffs...                                   │
│                                                                 │
│  Retries: 1 (test failure at 10:43:02, self-resolved)           │
│  Errors: 0 unresolved                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The Log auto-scrolls to the latest entry while the task is running. Errors and retries are highlighted. If the agent retried and self-resolved (like the test failure above), it's logged but not alarming. Unresolved errors that caused the agent to stall are prominently flagged.

**Group controls** appear in the task detail panel for any task belonging to an active group. The controls operate on the group, not the individual task — pausing pauses the whole group's agent session. Controls also appear on:

- **Project overview → Active Agents panel** — inline on each running group
- **Dependency graph** — toolbar action when a running group cluster is selected
- **Swimlane cards** — on Active group cards
- **PR tab** — on groups with open PRs where agents are actively fixing CI/addressing comments
- **Notifications** — quick-action buttons on "agent blocked" or "agent needs input" notifications

Control semantics:

- **⏸ Pause** — agent session suspends, worktree preserved, current task stays "in progress." Available when group is Active.
- **⏹ Stop** — agent session killed, worktree preserved with current changes. Tasks revert to Planned. Available when group is Active or Paused.
- **▶ Resume** — resumes a paused session with full context. Available when group is Paused.
- **🔄 Restart** — for stopped groups. Creates a new agent session. Optionally accepts a note ("use X approach instead") that becomes context for the new session. Available when group is Stopped.

### Tab: Diffs

The diff viewer, scoped per task group (each group has its own worktree/branch). Since each task group is an independent worktree, you review one group at a time.

**Group selector:** If the project has multiple groups with diffs, a dropdown at the top lets you pick which group's worktree to view. Shows group name + status (e.g. "Token refresh — Review", "Add endpoints — Active"). If only one group has diffs, the dropdown is hidden — you go straight to the diffs.

**View modes:** A segmented control below the group selector (or at the top if no dropdown) toggles between three views:

- **Latest Changes** (default) — what the agent just produced, pending review. This is the primary review interface.
- **Commit History** — list of commits on this group's branch. Click a commit to see its individual diff. Useful for understanding how the agent got to the current state, especially after multiple review rounds.
- **Branch Diff** — all accumulated changes on this group's branch vs origin main/master (`git diff main...HEAD`). The "what will this PR look like" view. Natural place to do a final review before creating a PR — surfaces a "Create PR" button when the group is in Review state.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Group: [auth-hook ▾]    [Latest Changes] [Commits] [Branch ∆] │
├──────────────────────┬──────────────────────────────────────────┤
│  File Tree           │  Diff View                               │
│                      │                                          │
│  ▼ engy-app          │  src/hooks/useAuth.ts                    │
│    src/hooks/        │  ┌──────────────────────────────────────┐│
│      useAuth.ts   ←  │  │ - import { useState } from 'react'   ││
│    src/components/   │  │ + import { useState, useEffect }    ││
│      AuthProvider.tsx│  │ + import { refreshToken } from ...   ││
│    src/utils/        │  │                                      ││
│      token.ts        │  │   export function useAuth() {        ││
│                      │  │ +   useEffect(() => {               ││
│                      │  │ +     // Set up token refresh...     ││
│                      │  │ +   }, [])                           ││
│                      │  │                                      ││
│                      │  │  💬 Comment on line 12:              ││
│                      │  │  "Use the cached value here"         ││
│                      │  └──────────────────────────────────────┘│
│                      │                                          │
│                      │  [Approve ✓]  [Request Changes ✏️]       │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

**Commit History view:**

```text
┌─────────────────────────────────────────────────────────────────┐
│  Group: [auth-hook ▾]    [Latest Changes] [Commits] [Branch ∆] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  abc1234  Add token refresh hook and provider     2 hours ago   │
│  def5678  Wire up refresh interval config         4 hours ago   │
│  ghi9012  Initial auth hook scaffold              6 hours ago   │
│                                                                 │
│  Click a commit to view its diff                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Branch Diff view:**

```text
┌─────────────────────────────────────────────────────────────────┐
│  Group: [auth-hook ▾]    [Latest Changes] [Commits] [Branch ∆] │
│  Showing all changes on auth-revamp/token-refresh vs main       │
├──────────────────────┬──────────────────────────────────────────┤
│  File Tree           │  Diff View (cumulative)                  │
│                      │                                          │
│  3 files changed     │  (same diff layout as Latest Changes,    │
│  +142 −23            │   but showing the full branch delta)     │
│                      │                                          │
│  ▼ engy-app          │                                          │
│    src/hooks/        │                                          │
│      useAuth.ts      │                                          │
│    src/components/   │                                          │
│      AuthProvider.tsx│                                          │
│    src/utils/        │                                          │
│      token.ts        │  [Create PR]  (when group is in Review)  │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

Left panel: file tree for the selected group's worktree. Shows changed files with additions/deletions count. Each file has an "Open in VS Code" icon button to jump directly to the file in the editor.

Right panel: unified diff view with syntax highlighting, line-level commenting. Comments route to the agent session that produced the code.

Action buttons: In Latest Changes view, "Approve" triggers auto-commit → push → PR creation. "Request Changes" routes feedback to the agent. In Branch Diff view, "Create PR" appears when the group is ready.

### Tab: PRs

Open PRs for this project's task groups. The monitoring view.

```text
┌─────────────────────────────────────────────────────────────────┐
│  [Open]  [Merged]                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PR #47: Token refresh flow                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Group: token-refresh · Branch: auth-revamp/token-refresh│    │
│  │  CI: ✅ All checks passed                                │    │
│  │  Reviews: 1 approved, 0 changes requested                │    │
│  │  Comments: 3 (all resolved by agent)                     │    │
│  │  Status: Ready to merge                      [Merge ▶]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  PR #48: Auth hook component                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Group: auth-hook-component · Branch: auth-revamp/auth-hook  │
│  │  CI: 🔴 2 checks failed                                 │    │
│  │    → Agent fixing: "Type error in useAuth.ts" (2m ago)   │    │
│  │  Reviews: pending                                        │    │
│  │  Comments: 1 unresolved                                  │    │
│  │  Status: CI in progress                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  PR #49: Context provider                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Group: context-provider · Branch: auth-revamp/ctx-prov  │    │
│  │  CI: ⚠️ Agent couldn't resolve — needs your input        │    │
│  │  Reviews: 1 changes requested                            │    │
│  │  Comments: 2 unresolved                                  │    │
│  │  Status: Needs attention                   [View Diffs]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each PR card shows: PR number/title, task group link, branch, CI status (with agent fix status if applicable), review status, comment count, overall status. Actions: "Merge" (when ready), "View Diffs" (opens in Diffs tab with PR context).

PRs that need human attention surface prominently (CI failures the agent couldn't fix, unresolved reviewer comments).

Tabs: "Open" (active PRs) and "Merged" (history).

### Tab: Plan

The implementation plan — a living document that grows progressively as milestones are planned.

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Spec: auth-revamp/spec.md                        [View Spec →] │
│                                                                 │
│  M1: Backend auth endpoints                          ✅ Complete │
│    Group: add-endpoints (T150, T151)                            │
│    Group: validate-schema (T152, T153)                          │
│    Group: error-handling (T154)                                  │
│                                                                 │
│  M2: Token refresh flow                              ✅ Complete │
│    Group: token-refresh (T160, T161, T162)                      │
│                                                                 │
│  M3: Frontend auth hooks                             ⏳ Active   │
│    Group: auth-hook-component (T165, T166)                      │
│    Group: context-provider (T170, T171)                         │
│    Group: logout-flow (T175)                                    │
│                                                                 │
│  M4: Integration tests                          📋 Ready to plan │
│    "E2E tests for all auth flows + load testing"                │
│                                              [Plan Milestone →] │
│                                                                 │
│  M5: Deployment + migration                        ☐  Planned   │
│    "CI/CD pipeline changes + DB migration scripts"              │
│                                                                 │
│  Key Decisions                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  • JWT over session tokens for stateless auth            │    │
│  │  • 15-minute access token TTL, 7-day refresh             │    │
│  │  • Argon2 for password hashing (not bcrypt)              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The plan reflects progressive planning. Completed and active milestones show their full group → task hierarchy. Milestones that haven't been planned yet show their rough scope description and a "Plan Milestone" action that triggers the planning loop in the terminal. Planned milestones (not yet ready to plan) are dimmed with just their scope text.

Key decisions accumulate across all planning phases — project-level decisions from initial planning, plus milestone-level decisions as each milestone is planned.

---

## Spec Detail (within Specs tab)

Spec detail is not a separate page — it's the right-panel content shown when you select a spec in the workspace Specs tab. The left tree stays visible for navigation between specs. The Content and Tasks sub-tabs described above provide the full spec interaction surface.

Clicking context files in the left tree (under a spec's `context/` directory) opens them in the Content sub-tab. These are the outputs of completed spec research tasks — you can review them, leave comments, and iterate with the agent.

"Create Project →" navigates to the newly created project's overview page.

---

## Navigation Flows

### Spec-Driven Development Flow (through the UI)

```text
Home → Workspace (Specs tab)
  → [+ New Spec] → Spec Detail (Draft)
    → create research tasks → tasks execute → context files appear
    → write/refine spec → [Mark Ready]
    → review (inline comments) → [Approve]
    → [Create Project →] → Project Overview (Planning)
      → plan via terminal → Tasks tab (Dependency Graph)
      → agents execute → Diffs tab (review)
      → [Approve] → PRs tab (monitoring)
      → all merged → Project completes
        → memory promotion + system doc review
        → project deleted
  → back to Workspace (Overview)
```

### Quick Bug Fix Flow (Default Project)

```text
Home → Workspace (Tasks tab = Default Project)
  → [+ New Task] → create task
  → assign as AI → agent executes → Diffs tab (review)
  → [Approve] → auto-commit, PR, merge
  → per-task completion step (system doc update? memory?)
  → done
```

### Ad-Hoc Terminal Flow

```text
Any page → Terminal: "fix the auth bug in useAuth.ts"
  → terminal works directly in repo
  → changes appear in Diffs tab of the relevant project
  → review + commit flow as normal
```

---

## Terminal Context Rules

The terminal maintains its session but updates its context injection based on navigation:

| Location | Terminal Context |
|----------|-----------------|
| Home | Workspace list, no specific project |
| Workspace Overview | Workspace config, all projects summary |
| Workspace Specs tab | Workspace specs, system docs for reference |
| Spec Detail | This spec's content + context files + tasks |
| Workspace Docs tab | System docs + shared docs |
| Workspace Memory tab | Memory collection, search capabilities |
| Workspace Tasks tab | Default project tasks |
| Project Overview | Project plan, milestones, agent status |
| Project Tasks tab | Task details, dependencies, agent sessions |
| Project Diffs tab | Current diffs, file context, agent session for feedback |
| Project PRs tab | PR status, CI logs, reviewer comments |
| Project Plan tab | Implementation plan, spec reference |

Context updates are additive — navigating deeper adds context, it doesn't replace. Moving from Project Overview to Project Tasks adds the task detail context on top of the project context.

---

## Component Inventory

Reusable components across the app:

- **Content Editor** — BlockNote-style rich markdown editor with inline comments. Used for specs, system docs, shared docs, memory detail.
- **Diff Viewer** — Syntax-highlighted unified diff with line-level commenting, approve/request changes actions.
- **Dependency Graph** — Flowchart task visualization with nodes, edges, group clusters. Used in project Tasks tab and spec Tasks view.
- **Eisenhower Matrix** — 4-quadrant grid for task prioritization. Used in Default project tasks and project Tasks tab.
- **Swimlane Board** — Milestone lanes with task group cards. Used in project Tasks tab.
- **File Tree** — Collapsible tree for specs, docs, context files. Used in Specs tab, Docs tab, Diffs tab, Spec Detail.
- **Task List** — Flat list with status, type, filters. Used in spec tasks, Default project list view.
- **Progress Bar** — Milestone-based progress visualization. Used in project cards, overview pages.
- **Task Detail Panel** — Slide-out panel for task inspection. Human tasks: description + checkbox. AI tasks: Content and Log sub-tabs. Includes group controls (pause/stop/resume/restart). Used everywhere tasks are clickable.
- **Execution Log** — Real-time agent activity stream with timestamps, tool calls, errors, retries. Part of the task detail panel's Log tab.
- **Group Controls** — Pause/stop/resume/restart buttons for task groups. Used in task detail, project overview agent panel, dependency graph, swimlane cards, PR tab, notifications.
- **Agent Status Panel** — Active agent summary with current task, status, elapsed time, inline group controls. Used in project overview.
- **Activity Feed** — Reverse-chronological event list. Used in workspace overview, project overview.
- **Notification Panel** — Slide-out/dropdown notification list with deep links.
- **Search Results** — Grouped results (docs, specs, tasks, memories) with type badges and navigation.
- **"Open in VS Code" Button** — Small icon button that opens a file path or worktree directory in VS Code (via `code` CLI). Appears on diff viewer file tree items, task detail (worktree path), project overview (repo paths). Bridges Engy's review layer with hands-on editing.

---

## Responsive Design

Engy must work on mobile. The primary use case on mobile is **monitoring and review** — checking agent status, reviewing diffs, approving PRs, responding to blocked agents, reading notifications. Heavy authoring (spec writing, planning) happens on desktop. The layout adapts accordingly.

### Breakpoints

Three layout tiers:

- **Desktop** (≥1024px) — full two-panel layout: main content + terminal side panel.
- **Tablet** (768–1023px) — main content full-width, terminal as a resizable bottom sheet (collapsed by default).
- **Mobile** (<768px) — single-column layout, terminal as a full-screen overlay.

### Mobile Layout

```text
┌─────────────────────────┐
│  ☰  Home > engy   🔍 🔔 │  ← Compact header, hamburger for nav
├─────────────────────────┤
│                         │
│   Full-width content    │
│                         │
│   (single column,       │
│    cards stack           │
│    vertically)          │
│                         │
│                         │
│                         │
├─────────────────────────┤
│  [ Overview | Tasks | … ]│  ← Scrollable tab bar
└─────────────────────────┘
         ┌───┐
         │ > │  ← Floating terminal button (bottom-right)
         └───┘
```

**Terminal on mobile:** The terminal becomes a full-screen overlay activated by a floating action button. Tap to open, swipe down or tap X to dismiss. The terminal session persists — you're toggling visibility, not creating/destroying sessions. This is for quick commands and responding to agent queries, not long interactive sessions.

**Breadcrumbs on mobile:** Collapse to show only the current page name with a back arrow. Tapping the hamburger menu shows the full navigation tree.

### Component Adaptations

**Two-panel layouts (tree + editor, file list + diff):**

On mobile, these become sequential screens instead of side-by-side:

```text
Desktop:                          Mobile:
┌──────────┬───────────┐         ┌─────────────────┐
│  Tree    │  Editor   │   →     │  Tree (list)    │
│          │           │         │  > spec.md      │
│          │           │         │  > context/     │
└──────────┴───────────┘         │  > brainstorm   │
                                 └─────────────────┘
                                        │ tap
                                        ▼
                                 ┌─────────────────┐
                                 │  Editor          │
                                 │  (full screen)   │
                                 │                  │
                                 │  [← Back]        │
                                 └─────────────────┘
```

Tree becomes a full-width list. Tapping a file navigates to the editor as a new screen. Back button returns to the tree. Same pattern for: Specs tab, Docs tab, Diffs tab file tree, Spec Detail context files.

**Diff viewer on mobile:**

Single-column unified diff. File tree collapses into a dropdown selector at the top ("src/hooks/useAuth.ts ▼"). Line commenting works via tap — tap a line to open the comment input. Approve/Request Changes buttons stick to the bottom of the screen.

```text
┌─────────────────────────┐
│  Group: auth-hook        │
│  [src/hooks/useAuth.ts ▼]│  ← File selector dropdown
├─────────────────────────┤
│  - import { useState }   │
│  + import { useState,    │
│    useEffect }           │
│  + import { refreshToken │
│    } from ...            │
│                          │
│  💬 "Use cached value"   │
│                          │
├─────────────────────────┤
│  [Approve ✓] [Changes ✏️]│  ← Sticky bottom bar
└─────────────────────────┘
```

**Dependency graph on mobile:**

Pannable and zoomable (pinch-to-zoom, drag-to-pan). Defaults to a simplified view — nodes as compact cards in a vertical list sorted by dependency order, with dependency indicators (arrows or indentation) rather than a full flowchart. Toggle to the full graph view if needed. Tapping a node opens task detail as a bottom sheet.

```text
┌─────────────────────────┐
│  [List ▼] [Graph]        │
├─────────────────────────┤
│  ✅ T150 Add auth route  │
│    └→ ⏳ T152 Validate   │
│  ✅ T151 Add middleware   │
│    └→ ⏳ T153 Error hdlr │
│         └→ ☐ T155 Wire  │
│  🔴 T156 Get API keys    │  [Human]
│    └→ ☐ T158 Integrate  │
├─────────────────────────┤
│  Tap task for detail     │
└─────────────────────────┘
```

**Eisenhower matrix on mobile:**

The 2×2 grid stacks into a single column with four collapsible sections:

```text
┌─────────────────────────┐
│  ▼ Urgent + Important    │
│    ☐ Fix prod auth bug   │
│    ☐ Get API keys        │
│  ▼ Not Urgent + Important│
│    ☐ Refactor error hdlr │
│    ☐ Update README       │
│  ▶ Urgent + Not Important│
│  ▶ Not Urgent + Not Imp. │
└─────────────────────────┘
```

**Swimlane board on mobile:**

Milestones stack vertically. Task group cards within each milestone scroll horizontally.

```text
┌─────────────────────────┐
│  M1: Backend endpoints ✅│
│  ┌────┐ ┌────┐ ┌────┐   │
│  │add │ │val │ │err │ ←→ │  ← Horizontal scroll
│  │ ✅  │ │ ✅  │ │ ✅  │   │
│  └────┘ └────┘ └────┘   │
│                          │
│  M3: Frontend hooks ⏳   │
│  ┌────┐ ┌────┐ ┌────┐   │
│  │hook│ │ctx │ │log │ ←→ │
│  │ ⏳  │ │ 🔴  │ │ ☐  │   │
│  └────┘ └────┘ └────┘   │
└─────────────────────────┘
```

**PR cards on mobile:**

Full-width stacked cards. CI status, review status, and action buttons are prominent. "Needs attention" PRs surface first.

**Content editor on mobile:**

Full-width editing. The BlockNote editor adapts to touch — block handles become swipe gestures, toolbar collapses to a floating mini-bar. Inline comments open as bottom sheets rather than margin popups.

### Mobile Navigation

**Tab bar:** Scrollable horizontal tabs at the top of each page. Active tab is highlighted. If more than 4-5 tabs, they scroll horizontally with the active tab always visible.

**Hamburger menu (☰):** Opens a slide-out navigation drawer showing the full hierarchy:

```text
┌─────────────────────────┐
│  ☰ Navigation            │
│                          │
│  Home                    │
│  ▼ engy                  │
│    Overview              │
│    Specs                 │
│    Docs                  │
│    Memory                │
│    Tasks (Default)       │
│    ▼ auth-revamp         │
│      Overview            │
│      Tasks               │
│      Diffs               │
│      PRs                 │
│      Plan                │
│    ▶ ci-overhaul         │
│    ▶ plan-mode           │
│  ▶ personal-site         │
└─────────────────────────┘
```

### Notification Handling on Mobile

Notifications are critical on mobile — this is likely where you first learn an agent is blocked or a PR needs attention. The notification bell opens a full-screen notification list (not a small dropdown). Each notification is a tappable card that deep-links to the relevant view. Push notifications (if the app supports it via PWA or native wrapper) for high-priority items: agent blocked, CI failure unresolvable, task group ready for review.

### What Mobile Deprioritizes

Mobile is not optimized for:

- Long spec writing sessions (use desktop)
- Complex planning interactions (use desktop)
- Extended terminal sessions (use desktop)
- Drag-and-drop task reorganization (use desktop)

Mobile is optimized for:

- Checking project/agent status at a glance
- Reviewing and approving diffs
- Responding to blocked agents (via terminal overlay)
- Reading and dismissing notifications
- Quick task creation
- PR monitoring (CI status, reviewer feedback)
- Reading specs and system docs
