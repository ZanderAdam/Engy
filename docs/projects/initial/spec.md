---
title: ''
status: active
type: buildable
---
# Software Requirements Specification

## Engy — v0.2

**Prepared by:** Aleks\
**Date:** 2026-03-01\
**Status:** In Review

***

## 1. Introduction

### 1.1 Purpose

This document specifies the complete requirements for Engy, an AI-assisted engineering workspace manager for spec-driven development. It covers all planned functionality from foundation through full autonomy (milestones M1–M11). This is the master SRS — child specs for individual milestones reference this document for shared context.

### 1.2 Scope

Engy is a single-user, local-first application providing a permanent home for ongoing engineering concerns (workspaces) and ephemeral scopes for bounded work (projects). It will:

* Manage multi-repo workspaces with knowledge persistence across projects

* Provide a rich spec authoring, planning, and review experience

* Orchestrate AI agents for autonomous code execution with human review gates

* Maintain a living knowledge layer (system docs, memory) that evolves with each completed project

* Integrate Claude Code CLI as the interactive action layer and Claude Agent SDK (via Mastra) for background autonomous execution

Engy will **not** provide: multi-user collaboration, GitLab/Bitbucket support, self-hosting distribution, or cross-workspace project coordination.

### 1.3 References

| Document             | Location                    | Description                                  |
| -------------------- | --------------------------- | -------------------------------------------- |
| Vision Document      | `initial.vision.md`         | Product vision and design philosophy         |
| UI Design            | `context/ui-design.md`      | Global layout, page designs, component specs |
| SDD Workflow         | `context/sdd-workflow.md`   | Full spec-driven development loop reference  |
| Filesystem Structure | `context/filesystem.md`     | Canonical `.engy/` directory layout          |
| Dev Containers       | `context/dev-containers.md` | Docker sandbox design for async agents       |

***

## 2. Overall Description

### 2.1 Product Perspective

Engy is a new product. It is a standalone web application with a companion client daemon. It integrates with:

* **Claude Code CLI** — interactive AI terminal (embedded via xterm.js)

* **Claude Agent SDK / Mastra** — autonomous background agent runtime

* **GitHub** — PR creation, CI monitoring, reviewer comments (via `gh` CLI)

* **Git** — worktree management, branch operations, diff computation

* **VS Code** — "Open in VS Code" integration for file editing

```text
┌──────────────────────┐     ┌──────────────────────┐
│   Browser (UI)       │     │   Claude Code CLI     │
│   Next.js App Router │     │   (user's terminal)   │
└────────┬─────────────┘     └────────┬──────────────┘
         │ HTTP/WS                    │ MCP (SSE)
         │                            │
┌────────▼────────────────────────────▼──────────────┐
│   Engy Server (Next.js + custom HTTP)              │
│   - tRPC API (browser)                             │
│   - MCP Server (AI agents)                         │
│   - WebSocket relay (client daemon)                │
│   - SQLite (Drizzle ORM)                           │
│   - qmd (hybrid search — BM25 + vector + reranking) │
└────────┬───────────────────────────────────────────┘
         │ WebSocket
┌────────▼───────────────────────────────────────────┐
│   Client Daemon (user's machine)                   │
│   - Path validation, git ops, file watching        │
│   - Claude Code process management                 │
│   - Worktree management                            │
│   - Optional: Docker container management          │
└────────────────────────────────────────────────────┘
```

### 2.2 Product Features (Summary)

* **F1** Workspace management — multi-repo topology, `.engy/` initialization, settings hierarchy

* **F2** Spec authoring — tree browser, rich editor, inline comments, spec tasks, lifecycle management

* **F3** Project planning — spec-to-project transition, milestones, task groups, progressive planning, three project views

* **F4** Terminal integration — context-scoped Claude Code CLI panel, multi-tab, auto-start agents

* **F5** Diff viewer & review — three view modes, line-level commenting, batched feedback, pre-commit gate

* **F6** Execution engine — worktree management, task group lifecycle, auto-commit, push, PR creation

* **F7** Knowledge layer — system docs, shared docs, memory architecture, qmd hybrid search, project completion flow

* **F8** Workspace polish — dashboard, notifications, settings, activity feed, cost visibility

* **F9** Async agents — Mastra integration, autonomous agent sessions, feedback routing

* **F10** Dev containers — optional Docker sandbox with network firewall for unattended agent execution

* **F11** PR/CI monitoring — CI failure auto-fix, reviewer comment triage, automated PR lifecycle

### 2.3 User Classes

| User Class     | Description                                                                                      | Priority                  |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| Solo Developer | Single user managing workspaces, writing specs, reviewing AI output, operating the full SDD loop | Primary (only user class) |

### 2.4 Operating Environment

* **Server:** Node.js (Next.js 16 App Router), runs locally or remotely

* **Client daemon:** Node.js, runs on the developer's machine

* **Browser:** Modern Chromium-based browsers (dark mode only), responsive down to mobile (768px breakpoint)

* **Database:** SQLite (WAL mode, via Drizzle ORM + better-sqlite3)

* **Search:** qmd (`@tobilu/qmd` — local hybrid search: BM25 + vector embeddings + LLM reranking)

* **AI:** Anthropic Claude API (Claude Code CLI + Claude Agent SDK)

* **Git provider:** GitHub (via `gh` CLI)

* **Container runtime:** Docker (optional, for dev containers)

* **Package manager:** pnpm (monorepo with Turborepo)

### 2.5 Constraints

* Single-user only — no authentication, no multi-tenancy

* GitHub only — no GitLab/Bitbucket

* Anthropic Claude only — no OpenAI/other LLM providers

* SQLite only — no PostgreSQL/MySQL

* Mobile is monitoring/review-focused — heavy authoring happens on desktop

* `gh` CLI must be installed and authenticated for PR operations

* Docker must be installed for dev container features (optional)

### 2.6 Assumptions & Dependencies

* User has Node.js, pnpm, and git installed

* User has a valid Anthropic API key for Claude Code CLI

* User has `gh` CLI installed and authenticated for GitHub operations

* Repos are local git repositories accessible from the client daemon machine

* Server and client can communicate over WebSocket (local or network)

* qmd runs in-process via `@tobilu/qmd` SDK (SQLite-backed, no external service required)

***

## 3. External Interface Requirements

### 3.1 User Interfaces

Two-panel layout on every page: main content area (left) + terminal panel (right). The terminal panel is resizable, collapsible, and tab-based. A persistent header provides breadcrumbs, global search, notifications, and settings. All primary actions live in the top-right action bar of the main content area.

**Responsive layout:** Desktop (>1024px) uses the two-panel layout. Tablet (768–1024px) collapses to single panel with terminal as slide-over. Mobile (<768px) uses single-column layout with terminal as full-screen overlay (floating action button to toggle). Mobile is optimized for monitoring and review (agent status, diffs, notifications, approvals) — heavy authoring (spec writing, planning) happens on desktop. Two-panel views (spec tree + editor, memory browser + detail) become sequential screens on mobile.

Pages: Home (workspace list), Workspace (tabbed: Overview, Specs, Docs, Tasks, Memory), Project (tabbed: Overview, Tasks, Plan, Diffs, PRs), Spec detail, Task detail (slide-out panel). See `context/ui-design.md` for full wireframes and responsive breakpoints.

### 3.2 Software Interfaces

| Interface         | Protocol         | Description                                                 |
| ----------------- | ---------------- | ----------------------------------------------------------- |
| tRPC API          | HTTP (batch)     | Browser UI ↔ server. superjson transformer, httpBatchLink.  |
| MCP Server        | SSE + HTTP POST  | AI agents ↔ server. GET = SSE stream, POST = messages.      |
| WebSocket (`/ws`) | WS               | Server ↔ client daemon. Typed discriminated union protocol. |
| GitHub API        | HTTPS (via `gh`) | PR creation, CI status, reviewer comments.                  |
| Docker API        | Unix socket      | Client daemon ↔ Docker for container lifecycle (optional).  |
| qmd               | In-process SDK   | Server ↔ qmd store for hybrid search indexing and queries.  |
| Claude API        | HTTPS            | Agent sessions ↔ Anthropic API for LLM inference.           |

### 3.3 Hardware Interfaces

Not applicable. Engy is a pure software application.

***

## 4. Non-Functional Requirements

### 4.1 Performance

| ID   | Requirement                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------- |
| NF-1 | UI page transitions shall complete within 200ms for local deployments.                                   |
| NF-2 | tRPC API responses shall complete within 100ms for standard CRUD operations (SQLite).                    |
| NF-3 | qmd search queries shall return results within 500ms for workspaces with up to 10,000 indexed documents. |
| NF-4 | File watcher shall detect changes and sync to UI within 1 second.                                        |
| NF-5 | Terminal input latency shall not exceed 50ms (xterm.js → CLI process round-trip).                        |

### 4.2 Security

| ID   | Requirement                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| NF-6 | Dev containers shall block all outbound network traffic not in the allowlist via iptables.                            |
| NF-7 | Container bind mounts shall enforce read-only access to main branch directories.                                      |
| NF-8 | The MCP server shall not expose destructive operations (file deletion, repo management) without explicit user action. |

### 4.3 Reliability / Availability

| ID    | Requirement                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| NF-9  | SQLite shall run in WAL mode for concurrent read/write reliability.                                                          |
| NF-10 | Agent sessions shall be crash-recoverable: worktree preserved, session state in SQLite, only in-progress task needs restart. |
| NF-11 | Network failures shall retry with backoff; persistent failures pause and notify the user.                                    |
| NF-12 | The qmd search index shall be fully rebuildable from source files via `engy reindex`.                                        |

### 4.4 Scalability

| ID    | Requirement                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------- |
| NF-13 | The system shall support workspaces with up to 50 repos and 100 active tasks without degradation. |
| NF-14 | The system shall support up to 10 concurrent agent sessions per workspace.                        |

### 4.5 Usability

| ID    | Requirement                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-15 | All primary actions shall be accessible from the top-right action bar — consistent placement across all pages.                                                                     |
| NF-16 | Terminal context shall auto-start with the appropriate agent — no manual setup required.                                                                                           |
| NF-17 | Every error shall auto-recover or surface as a notification with clear next steps. No silent failures.                                                                             |
| NF-18 | The UI shall be responsive across three breakpoints: desktop (>1024px), tablet (768–1024px), and mobile (<768px). Mobile shall support monitoring, review, and approval workflows. |

### 4.6 Maintainability

| ID    | Requirement                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| NF-19 | Server test coverage shall exceed 90% statements, 85% branches, 90% functions, 90% lines.                                     |
| NF-20 | The quality gate (`pnpm blt`) shall include: build, lint, test, dead code detection (knip), and copy-paste detection (jscpd). |
| NF-21 | Database migrations shall run automatically on server startup.                                                                |

***

## 5. Data Requirements

### 5.1 Data Model

**SQLite (execution state):**

| Entity         | Key Attributes                                                                                                              | Relationships                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Workspace      | id, name, slug, config                                                                                                      | → Project(s), FleetingMemory(ies), Comment(s) |
| Project        | id, name, slug, status, specReference, isDefault, workspaceId                                                               | → Milestone(s), Task(s), ProjectMemory(ies)   |
| Milestone      | id, title, status, ordering, scopeDescription, projectId                                                                    | → TaskGroup(s), Task(s)                       |
| TaskGroup      | id, name, status, reposList, milestoneId                                                                                    | → Task(s), AgentSession(s)                    |
| Task           | id, title, description, status, type (ai/human), importance, urgency, milestoneId, groupId, projectId, specId, dependencies | —                                             |
| AgentSession   | id, sessionId, taskGroupId, state, status                                                                                   | —                                             |
| FleetingMemory | id, content, type, workspaceId                                                                                              | —                                             |
| ProjectMemory  | id, content, type, projectId                                                                                                | —                                             |
| PlanContent    | id, content, milestoneId                                                                                                    | —                                             |
| Comment        | id, content, documentPath, anchorRange, resolved, workspaceId                                                               | —                                             |

**Filesystem (permanent knowledge):**

| Entity             | Location                           | Format                      |
| ------------------ | ---------------------------------- | --------------------------- |
| Workspace config   | `.engy/{workspace}/workspace.yaml` | YAML                        |
| System docs        | `.engy/{workspace}/system/`        | Markdown                    |
| Specs              | `.engy/{workspace}/specs/`         | Markdown + YAML frontmatter |
| Shared docs        | `.engy/{workspace}/docs/`          | Markdown                    |
| Permanent memories | `.engy/{workspace}/memory/`        | Markdown + YAML frontmatter |

**qmd (search index):**

| Content                       | Source              | Rebuild        |
| ----------------------------- | ------------------- | -------------- |
| All files + active DB content | Filesystem + SQLite | `engy reindex` |

### 5.2 Data Retention & Migration

* **Active projects:** Full SQLite state retained until project is archived.

* **Archived projects:** Compacted — plan content, milestones, groups, task structure, key decisions, final statuses retained. Agent session state, fleeting memories, execution logs discarded.

* **Permanent knowledge:** Files in `.engy/` persist indefinitely, versioned via git.

* **qmd:** Ephemeral — fully rebuildable from source files via `store.update()` + `store.embed()`. No migration needed.

* **SQLite migrations:** Run automatically on server startup via Drizzle ORM. New migrations generated with Drizzle Kit after schema changes.

***

## 6. Milestones & Implementation Plan

### 6.1 Summary

| #   | Milestone            | Exit Criteria                                                                                                                                                                                                                                                              |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Foundation           | Two running processes (server + client) communicating via WebSocket. SQLite with full schema. MCP server live. App shell with navigation. Workspace CRUD functional.                                                                                                       |
| M2  | Spec Authoring       | Specs can be authored in rich editor, context files managed, inline comments work, spec tasks tracked, file watcher syncs external changes, `engy:spec-assistant` skill works from terminal.                                                                               |
| M3  | Project Planning     | Approved spec → project creation. Milestones, task groups, tasks with dependencies. Three project views functional. Default project with Eisenhower matrix and per-task completion. Planning skills work from terminal. Auto-completion when all milestones finish.        |
| M4  | Terminal Integration | xterm.js panel on every page. Context-scoped auto-start for all page contexts. Multi-tab with splits. WebSocket bridge to CLI process on client. Read-only outside write scope. All prior skills auto-start in terminal panel.                                             |
| M5  | Diff Viewer & Review | Three diff view modes. Line-level commenting. Approve and Send Feedback actions. Pre-commit gate. Document feedback routing. Create PR from Branch Diff. Open in VS Code.                                                                                                  |
| M6  | Execution Engine     | Worktree creation/cleanup. Full task group state machine. Auto-commit, push, PR creation via `gh`. Cross-repo groups. Cross-workspace repo access. Execution visibility.                                                                                                   |
| M7  | Knowledge Layer      | Docs tab with system/shared docs. Memory tab with browser/editor. qmd hybrid search. Project completion with memory distillation and system doc proposals. Memory scoping (workspace/repo). Permanent memory schema. Bootstrap skill. Validate/reindex as terminal skills. |
| M8  | Workspace Polish     | Dashboard refinements. Notification system with all triggers. Hierarchical settings. Global search polish. Cost visibility.                                                                                                                                                |
| M9  | Async Agents         | Mastra integration. Persistent agent sessions. Crash recovery. Feedback routing to sessions. Auto-start mode. Execution log streaming.                                                                                                                                     |
| M10 | Dev Containers       | Docker containers start/stop on demand. Network firewall with allowlist. Bind-mounted repos. Container status in UI. Fallback to direct execution.                                                                                                                         |
| M11 | PR/CI Monitoring     | PRs tab with CI status. Auto-dispatch for CI fixes. Reviewer comment triage with selective fix dispatch.                                                                                                                                                                   |

### 6.2 Dependencies

| Milestone | Blocked By                                         | Notes                                                                                   |
| --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| M1        | —                                                  | Foundation, no dependencies                                                             |
| M2        | M1                                                 | Needs data layer, app shell, MCP server                                                 |
| M3        | M2                                                 | Needs spec authoring for spec → project transition                                      |
| M4        | M3                                                 | Needs project/spec pages to scope terminals to                                          |
| M5        | M4                                                 | Needs terminal for feedback routing                                                     |
| M6        | M5                                                 | Needs diff viewer for review flow                                                       |
| M7        | —                                                  | Can parallel with M5–M6 (independent knowledge subsystem), but depends on M1 data layer |
| M8        | M6, M7                                             | Needs all features to exist for polish                                                  |
| M9        | M5 (feedback routing), M6 (worktrees), M7 (memory) | Agent autonomy requires execution + knowledge foundation                                |
| M10       | M6 (worktrees), M9 (async agents)                  | Container sandbox requires agent execution model                                        |
| M11       | M6 (PR creation), M10 (dev containers)             | PR monitoring requires execution and sandboxed agent dispatch                           |

```text
M1 ──→ M2 ──→ M3 ──→ M4 ──→ M5 ──→ M6 ──┐
                                            ├──→ M8
                                    M7 ─────┘

M9  depends on: M5, M6, M7
M10 depends on: M6, M9
M11 depends on: M6, M10
```

### 6.3 M1: Foundation

**Description:** Workspaces are permanent entities representing ongoing concerns. They define multi-repo topology, hold shared knowledge, and contain ephemeral projects. Each workspace gets an initialized `.engy/` directory with standard structure.\
**Priority:** High

**Stimulus/Response:**

| Trigger                               | System Behavior                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User clicks "+ New Workspace" on Home | System presents creation flow: name, repo directories (with optional monorepo subdirectory scoping)                                                                                   |
| User submits workspace creation form  | System creates DB record, initializes `.engy/` directory (`workspace.yaml`, `system/`, `specs/`, `docs/`, `memory/`), creates Default project, validates repo paths via client daemon |
| User navigates to workspace           | System displays tabbed view (Overview, Specs, Docs, Tasks, Memory)                                                                                                                    |
| User opens workspace settings         | System displays repo configuration, agent config, notification overrides, terminal defaults                                                                                           |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-1.1  | The system shall create a workspace with a name, auto-generated slug, and one or more repo directories.                                                                                          |
| FR-1.2  | The system shall support monorepo subdirectory scoping — repo entries can point to subdirectories within a repository.                                                                           |
| FR-1.3  | The system shall validate repo paths by sending `VALIDATE_PATHS_REQUEST` to the client daemon and receiving `VALIDATE_PATHS_RESPONSE`.                                                           |
| FR-1.4  | The system shall initialize a `.engy/` directory on workspace creation containing `workspace.yaml`, `system/` (with `overview.md` placeholder), `specs/`, `docs/`, and `memory/`.                |
| FR-1.5  | The system shall support a configurable `.engy/` location (global setting, default: `~/.engy/`, can point to any path).                                                                          |
| FR-1.6  | The system shall auto-create a Default project for each workspace that cannot be deleted or completed.                                                                                           |
| FR-1.7  | The system shall use compensating actions for workspace creation — if filesystem init fails, the DB row is deleted; if default project insert fails, both filesystem and DB row are rolled back. |
| FR-1.8  | The system shall generate slugs using lowercase, non-alphanumeric → hyphens, collapse consecutive, strip edges, with collision resolution via `-2`, `-3`, etc.                                   |
| FR-1.9  | The system shall display workspace cards on the Home page with active project count, progress bars, agent status, and specs in progress.                                                         |
| FR-1.10 | The system shall provide a hierarchical settings model: global settings (Home page) and workspace settings (workspace page), with context-aware settings icon.                                   |
| FR-1.11 | The system shall use the workspace as a template for project creation — projects inherit repos, conventions, shared docs, and memory automatically.                                              |

**Exit Criteria:** Two running processes (server + client) communicating via WebSocket. SQLite with full schema. MCP server live. App shell with navigation. Workspace CRUD functional.

### 6.4 M2: Spec Authoring

**Description:** Specs are pre-project thinking spaces. Users author specs in a tree browser with a rich content editor, manage context files, leave inline review comments, and track spec research tasks. Specs have a lifecycle from Draft through Approved.\
**Priority:** High

**Stimulus/Response:**

| Trigger                             | System Behavior                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| User clicks "New Spec"              | System creates directory in `.engy/specs/`, initializes `spec.md` with frontmatter |
| User edits spec in content editor   | System saves changes to filesystem                                                 |
| User leaves inline comment on spec  | System stores comment in SQLite anchored to content range                          |
| User clicks "Mark Ready"            | System validates all spec tasks are complete, transitions status to Ready          |
| User clicks "Approve" on spec       | System transitions status to Approved, enables "Create Project →" action           |
| External edit to spec file detected | File watcher picks up change, syncs to UI                                          |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-2.1  | The system shall provide a Specs tab with a tree view (left panel) reflecting the `.engy/specs/` filesystem structure.                                                   |
| FR-2.2  | The system shall provide a BlockNote-based rich markdown content editor (right panel) for `spec.md` and context files.                                                   |
| FR-2.3  | The system shall support spec lifecycle status transitions: Draft → Ready → Approved → Active → Completed.                                                               |
| FR-2.4  | The system shall support Vision specs with lifecycle: Draft → Completed (no project path).                                                                               |
| FR-2.5  | The system shall allow context file browsing — expanding a spec directory shows `context/` files, clickable to view/edit.                                                |
| FR-2.6  | The system shall support inline comments on documents: create, view, resolve, delete — stored in SQLite, anchored to content ranges.                                     |
| FR-2.7  | The system shall support spec tasks using the same task system as projects (`tasks` table, `specId` set). Flat list with dependencies, no milestones or groups.          |
| FR-2.8  | The system shall prevent a spec from moving to Ready until all tasks are done or explicitly dropped.                                                                     |
| FR-2.9  | The system shall provide a file watcher on `.engy/specs/` that detects external spec file changes and syncs to the UI.                                                   |
| FR-2.10 | The system shall support "Open in VS Code" for spec files (via `code` CLI).                                                                                              |
| FR-2.11 | The system shall allow specs to be edited at any time during project execution — specs are living documents.                                                             |
| FR-2.12 | The system shall provide an `engy:spec-assistant` Claude Code skill for guided spec drafting, research task creation, and context file generation.                       |
| FR-2.13 | The system shall support numerical prefix ordering for child specs carved from a vision spec (e.g., `1_storage-layer/`, `2_workspace-model/`), establishing build order. |

**Exit Criteria:** Specs can be authored in rich editor, context files managed, inline comments work, spec tasks tracked, file watcher syncs external changes, `engy:spec-assistant` skill works from terminal.

### 6.5 M3: Project Planning

**Description:** Projects are created from approved specs. They contain milestones, task groups, and tasks. Planning is progressive — project-level first (milestones with rough scope), then milestone-level (groups and tasks), then optionally task-level (implementation plan). Three project views visualize execution state.\
**Priority:** High

**Stimulus/Response:**

| Trigger                                         | System Behavior                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| User clicks "Create Project →" on approved spec | System creates project in SQLite, links to spec, updates spec status to Active                                                    |
| User triggers milestone planning                | Terminal starts planning skill, decomposes milestone into groups and tasks                                                        |
| User views Project Tasks tab                    | System displays dependency graph (default), with toggles for swimlane board and Eisenhower matrix                                 |
| User clicks task in any view                    | System shows task detail slide-out panel                                                                                          |
| Default project task completes                  | System evaluates whether task produced anything worth capturing (memory promotion, system doc update); surfaces review flow if so |
| All milestones in a project complete            | System automatically advances project to Completing status                                                                        |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-3.1  | The system shall create a project from an approved spec, linking the project to the spec and setting spec status to Active.                                                                                                                           |
| FR-3.2  | The system shall support project lifecycle: Planning → Active → Completing → Archived.                                                                                                                                                                |
| FR-3.3  | The system shall support milestone CRUD with ordering and status transitions: Planned → Planning → Active → Complete.                                                                                                                                 |
| FR-3.4  | The system shall support task group CRUD with status tracking, scoped to milestones.                                                                                                                                                                  |
| FR-3.5  | The system shall support task CRUD with dependencies, type (`ai`/`human`), importance/urgency classification, milestone and group assignment.                                                                                                         |
| FR-3.6  | The system shall detect dependency cycles using iterative DFS (`detectCycle()`).                                                                                                                                                                      |
| FR-3.7  | The system shall provide three project views: dependency graph (default), swimlane board (milestone lanes), and Eisenhower matrix (urgent/important quadrants).                                                                                       |
| FR-3.8  | The system shall provide a task detail slide-out panel with description, dependencies, status, type, milestone/group assignment, and importance/urgency.                                                                                              |
| FR-3.9  | The system shall store plan content per milestone in SQLite.                                                                                                                                                                                          |
| FR-3.10 | The system shall support progressive planning: project → milestones (rough scope), milestone → groups/tasks (detailed), task → implementation plan (optional).                                                                                        |
| FR-3.11 | The system shall support the Default project as a flat task list with dependencies, no milestones or groups, using the Eisenhower matrix view.                                                                                                        |
| FR-3.12 | The system shall allow users to manually advance projects to Completing at any time (remaining work dropped, memory distillation and system doc review still run).                                                                                    |
| FR-3.13 | The system shall provide `engy:project-assistant` and `engy:workspace-assistant` Claude Code skills for planning and ad-hoc work.                                                                                                                     |
| FR-3.14 | The system shall perform per-task completion evaluation for Default project tasks — when a task completes, the agent evaluates whether it produced anything worth capturing (memory promotion, system doc update) and surfaces the review flow if so. |
| FR-3.15 | The system shall automatically advance a project to Completing when all milestones are complete.                                                                                                                                                      |

**Exit Criteria:** Approved spec → project creation. Milestones, task groups, tasks with dependencies. Three project views functional. Default project with Eisenhower matrix and per-task completion. Planning skills work from terminal. Auto-completion when all milestones finish.

### 6.6 M4: Terminal Integration

**Description:** Claude Code CLI is embedded in an xterm.js terminal panel on the right side of every page. The terminal is context-scoped — its working directory and default agent adapt to the current page. Multiple terminals can be open simultaneously as tabs with splits.\
**Priority:** High

**Stimulus/Response:**

| Trigger                                        | System Behavior                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| User navigates to a page with terminal support | Terminal auto-starts with scope matching current page (working directory + default agent) |
| User opens new terminal tab                    | New terminal opens scoped to current page context                                         |
| User resizes terminal panel                    | Panel width adjusts, terminal re-renders                                                  |
| User collapses terminal                        | Main content area takes full width                                                        |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-4.1  | The system shall provide an xterm.js terminal panel on the right side of every page (except Home).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FR-4.2  | The system shall support tab-based terminal management with metadata labels showing scope (e.g., "spec: auth-revamp").                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FR-4.3  | The system shall support vertical and horizontal splits for side-by-side terminal work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FR-4.4  | The system shall provide a drag-resizable left edge on the terminal panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FR-4.5  | The system shall provide a collapsible terminal panel (keyboard shortcut + toggle button).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FR-4.6  | The system shall auto-start the appropriate Claude Code agent based on current page context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FR-4.7  | The system shall scope terminals per page context: Workspace Overview → workspace root + `engy:workspace-assistant`, Workspace Specs tab → `specs/` + `engy:spec-assistant`, Spec Detail → `specs/{slug}/` + `engy:spec-assistant`, Workspace Docs tab → `system/` + `docs/` + `engy:sysdoc-assistant`, Workspace Memory tab → `memory/` + `engy:workspace-assistant`, Workspace Tasks tab → workspace root + `engy:workspace-assistant`, Project Overview/Tasks/Plan → primary repo + `engy:project-assistant`, Project Diffs/PRs tab → group worktree (no special agent). |
| FR-4.8  | The system shall preserve terminal scope when navigating pages — open terminals keep their original scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FR-4.9  | The system shall manage Claude Code CLI processes on the client daemon: spawn, kill, resize.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FR-4.10 | The system shall provide a WebSocket bridge between xterm frontend and CLI process on client machine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-4.11 | The system shall pass working directory, agent name, and scope metadata when spawning CLI processes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FR-4.12 | The system shall enforce read-only access outside the terminal's write scope — agents can search, read, and reference any workspace content via MCP tools, but direct filesystem writes are limited to the scoped directory.                                                                                                                                                                                                                                                                                                                                                |

**Exit Criteria:** xterm.js panel on every page. Context-scoped auto-start for all page contexts. Multi-tab with splits. WebSocket bridge to CLI process on client. Read-only outside write scope. All prior skills auto-start in terminal panel.

### 6.7 M5: Diff Viewer & Review

**Description:** The diff viewer is the review and commit interface for all code changes. Scoped per task group, it provides three view modes (Latest Changes, Commit History, Branch Diff), line-level commenting, and a batched feedback model (approve or send feedback). A pre-commit gate enforces quality before committing.\
**Priority:** High

**Stimulus/Response:**

| Trigger                             | System Behavior                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User navigates to Project Diffs tab | System shows Latest Changes view for selected task group                                              |
| User clicks a line in the diff      | System opens inline comment input                                                                     |
| User clicks "Approve"               | System runs pre-commit gate → on pass, auto-commits                                                   |
| User clicks "Send Feedback"         | System batches all comments into structured markdown, routes to originating agent session or terminal |
| Pre-commit gate fails               | System surfaces errors for agent/user to fix                                                          |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-5.1  | The system shall provide three diff view modes: Latest Changes (pending review), Commit History (commits on group's branch), Branch Diff (all changes vs `origin/main`).                          |
| FR-5.2  | The system shall provide a task group selector when multiple groups have diffs (hidden if only one).                                                                                              |
| FR-5.3  | The system shall support line-level commenting on diffs, stored in SQLite linked to diff hunks (file, line range).                                                                                |
| FR-5.4  | The system shall support an "Approve" action that triggers the pre-commit gate and then auto-commits on pass.                                                                                     |
| FR-5.5  | The system shall support a "Send Feedback" action that batches all comments into a structured markdown payload with file/line references and routes to the originating agent session or terminal. |
| FR-5.6  | The system shall clear comments after sending feedback.                                                                                                                                           |
| FR-5.7  | The system shall support a per-repo pre-commit gate command configured in workspace settings (e.g., `yarn blt`, `cargo test`).                                                                    |
| FR-5.8  | The system shall execute the pre-commit gate on the client daemon in the relevant worktree.                                                                                                       |
| FR-5.9  | The system shall use the same batched review model for document feedback (inline comments → approve or send feedback).                                                                            |
| FR-5.10 | The system shall compute diffs via the client daemon: working tree changes, commit diffs, and branch comparisons.                                                                                 |
| FR-5.11 | The system shall provide "Open in VS Code" buttons on diff viewer file tree items, task detail panels (worktree path), and project overview (repo paths) via `code` CLI.                          |
| FR-5.12 | The system shall provide a "Create PR" action in the Branch Diff view when the task group is in Review state.                                                                                     |

**Exit Criteria:** Three diff view modes. Line-level commenting. Approve and Send Feedback actions. Pre-commit gate. Document feedback routing. Create PR from Branch Diff. Open in VS Code.

### 6.8 M6: Execution Engine

**Description:** The execution engine manages worktrees, task group lifecycle, auto-commit, push, and PR creation. Task groups progress through a state machine from Planned through Merged/Cleaned Up. The engine orchestrates sequential task execution within groups.\
**Priority:** High

**Stimulus/Response:**

| Trigger                  | System Behavior                                                             |
| ------------------------ | --------------------------------------------------------------------------- |
| User starts a task group | System creates worktree(s) per repo, activates group, begins task execution |
| User pauses a group      | System suspends session, preserves worktree                                 |
| User approves diffs      | System runs pre-commit gate, auto-commits, pushes, creates PR via `gh`      |
| All repos' PRs merge     | Task group advances to Merged, worktrees cleaned up                         |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-6.1  | The system shall create git worktrees per repo when a task group activates. Branch naming: `{project-slug}/{group-name}`.                                                                                            |
| FR-6.2  | The system shall support the task group lifecycle state machine: Planned → Active → Review → PR Open → Merged → Cleaned Up, with Paused and Stopped as side states.                                                  |
| FR-6.3  | The system shall provide task group controls: Start, Pause, Resume, Stop, Restart (with notes), Complete (skip PR flow).                                                                                             |
| FR-6.4  | The system shall execute tasks sequentially within a group, sending status updates to the server.                                                                                                                    |
| FR-6.5  | The system shall auto-commit after approval: stage files, generate commit message from task/plan context.                                                                                                            |
| FR-6.6  | The system shall push branches and create PRs via `gh pr create` after commit.                                                                                                                                       |
| FR-6.7  | The system shall clean up worktrees on group completion (Merged or Cleaned Up).                                                                                                                                      |
| FR-6.8  | The system shall support cross-repo task groups: one worktree per repo, diffs from all repos shown together, commits and PRs happen independently per repo, group advances to Merged only when all repos' PRs merge. |
| FR-6.9  | The system shall lock task groups once Active — regrouping requires Stop and re-plan.                                                                                                                                |
| FR-6.10 | The system shall provide execution visibility at three zoom levels: project overview (which agents running), dependency graph (task statuses), task detail (Content + Log tabs).                                     |
| FR-6.11 | The system shall broadcast task group state changes via WebSocket to the UI.                                                                                                                                         |
| FR-6.12 | The system shall allow task groups to reference repos outside the workspace when needed — workspace boundaries are organizational, not technical.                                                                    |

**Exit Criteria:** Worktree creation/cleanup. Full task group state machine. Auto-commit, push, PR creation via `gh`. Cross-repo groups. Cross-workspace repo access. Execution visibility.

### 6.9 M7: Knowledge Layer

**Description:** The knowledge layer encompasses system docs (living source of truth), shared docs (conventions, guides), the memory architecture (fleeting → permanent), qmd hybrid search (BM25 + vector + LLM reranking via `@tobilu/qmd`), and the project completion flow with memory distillation and system doc update proposals.\
**Priority:** High

**Stimulus/Response:**

| Trigger                               | System Behavior                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| User navigates to Docs tab            | System shows tree + editor layout with `system/` and `docs/` trees                 |
| User navigates to Memory tab          | System shows memory browser (left) with filters, memory detail (right) with editor |
| User searches via UI or terminal      | System queries qmd store (hybrid search), returns grouped results                  |
| Project completes                     | System runs memory distillation, proposes system doc updates in diff viewer        |
| User triggers "Bootstrap System Docs" | Bootstrap skill reads codebase, proposes initial system docs for review            |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-7.1  | The system shall provide a Docs tab with tree + editor layout for `system/` (features/, technical/) and `docs/` (shared conventions, guides).                                                                                                              |
| FR-7.2  | The system shall support inline comments on documents with the same batched review model as diffs.                                                                                                                                                         |
| FR-7.3  | The system shall provide a Memory tab with browser (filter by type, scope, tags + search) and detail view (content editor, metadata display).                                                                                                              |
| FR-7.4  | The system shall support manual memory creation and editing.                                                                                                                                                                                               |
| FR-7.5  | The system shall support memory promotion: review fleeting memories, promote to permanent (written to `.engy/memory/` as markdown with YAML frontmatter).                                                                                                  |
| FR-7.6  | The system shall provide periodic memory review — surfacing recent unpromoted candidates.                                                                                                                                                                  |
| FR-7.7  | The system shall integrate qmd (`@tobilu/qmd`) to index all content (specs, docs, tasks, memories) as collections with path-specific context.                                                                                                              |
| FR-7.8  | The system shall provide a search API using qmd hybrid search (BM25 + vector + LLM reranking) combined with SQLite structured queries, with results grouped by content type.                                                                               |
| FR-7.9  | The system shall provide `engy reindex` to rebuild the qmd store (`store.update()` + `store.embed()`) and `engy validate` for broken links, schema compliance, duplicate IDs, orphaned content, and lifecycle consistency.                                 |
| FR-7.10 | The system shall run memory distillation on project completion: evaluate project memories for promotion, deduplicate against existing permanent memories.                                                                                                  |
| FR-7.11 | The system shall propose system doc updates on project completion — agent proposes diffs that appear in the diff viewer for review.                                                                                                                        |
| FR-7.12 | The system shall archive completed projects: compact (preserve plan content, milestones, groups, task structure, key decisions, final statuses), discard agent session state, fleeting memories, execution logs.                                           |
| FR-7.13 | The system shall inject memory context to agents in order: project memories → workspace memories → repo memories (filtered by `repo` field).                                                                                                               |
| FR-7.14 | The system shall provide a bootstrap skill that reads codebase via client connection and proposes initial system docs.                                                                                                                                     |
| FR-7.15 | The system shall provide an `engy:sysdoc-assistant` Claude Code skill for editing system docs.                                                                                                                                                             |
| FR-7.16 | The system shall support memory scoping: workspace-scoped memories (cross-project learnings) and repo-scoped memories (repository-specific patterns, filtered by `repo` field — the universal join key across workspace boundaries).                       |
| FR-7.17 | The system shall store permanent memories as markdown files with YAML frontmatter containing: id, type, subtype (decision/pattern/fact/convention/insight), title, scope (workspace/repo), repo, confidence, source, tags, keywords (low-level retrieval terms), themes (high-level conceptual terms), linkedMemories, supersededBy (nullable reference to newer memory), and timestamps. |
| FR-7.18 | The system shall support `engy validate` and `engy reindex` as terminal skills — not just CLI commands.                                                                                                                                                    |

**Exit Criteria:** Docs tab with system/shared docs. Memory tab with browser/editor. qmd hybrid search. Project completion with memory distillation and system doc proposals. Memory scoping (workspace/repo). Permanent memory schema. Bootstrap skill. Validate/reindex as terminal skills.

### 6.10 M8: Workspace Polish

**Description:** Dashboard refinements, notifications, settings hierarchy, global search polish, activity feed, and cost visibility that make the experience cohesive.\
**Priority:** Medium

**Stimulus/Response:**

| Trigger                     | System Behavior                                                            |
| --------------------------- | -------------------------------------------------------------------------- |
| Agent needs input           | System creates notification (most urgent), links to relevant view          |
| Task group ready for review | System creates notification with link to diff viewer                       |
| User clicks notification    | System navigates to relevant view with terminal contextualized             |
| User opens settings         | System shows appropriate level (global or workspace) based on current page |

**Functional Requirements:**

| ID     | Requirement                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-8.1 | The system shall display Home page workspace cards with active project count, progress bars, agent status, and specs in progress.                                                                                                                                                                  |
| FR-8.2 | The system shall display the Workspace Overview with active projects, milestone progress, agent status, specs in progress, and a recent activity feed.                                                                                                                                             |
| FR-8.3 | The system shall provide a notification system with icon (badge + unread count), panel (slide-out or dropdown), and per-notification links to relevant views.                                                                                                                                      |
| FR-8.4 | The system shall trigger notifications for: agent needs input, task group ready for review, PR review received, CI failure, milestone completed, project ready for completion, system doc update proposed, validation warnings.                                                                    |
| FR-8.5 | The system shall provide global settings: Engy data directory, default AI model, notification defaults, appearance.                                                                                                                                                                                |
| FR-8.6 | The system shall provide workspace settings: repo directories with pre-commit commands, agent config (model, tools, MCP servers), notification overrides, terminal defaults, and dev container configuration (enabled flag, allowed domains, extra packages, environment variables, idle timeout). |
| FR-8.7 | The system shall provide a global search bar on every page with results grouped by type and keyboard shortcut to focus.                                                                                                                                                                            |
| FR-8.8 | The system shall track token usage per agent session, group, and project — surfaced in execution logs, project overview, and workspace settings.                                                                                                                                                   |

**Exit Criteria:** Dashboard refinements. Notification system with all triggers. Hierarchical settings. Global search polish. Cost visibility.

### 6.11 M9: Async Agents

**Description:** Mastra integration provides autonomous background agent execution. Agent sessions are persistent, resumable, and crash-recoverable. Feedback from the diff viewer routes back to the originating agent session.\
**Priority:** Medium

**Stimulus/Response:**

| Trigger                                        | System Behavior                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| User starts a task group                       | System activates Mastra agent session with full context injection                                   |
| Agent completes task, produces diffs           | Diffs surface in diff viewer for review                                                             |
| User sends feedback on agent diffs             | Structured payload routes to originating Mastra session, which resumes with feedback as new context |
| Agent crashes mid-execution                    | Worktree preserved, session resumable from SQLite state                                             |
| Auto-start mode enabled + dependencies resolve | System automatically activates next task group                                                      |

**Functional Requirements:**

| ID      | Requirement                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-9.1  | The system shall integrate Mastra runtime on the client for agent lifecycle management, tool coordination, and workflows.                                                         |
| FR-9.2  | The system shall support persistent, resumable agent sessions tied to task groups or spec tasks.                                                                                  |
| FR-9.3  | The system shall inject full context into agent sessions: spec, plan, tasks, memories, system docs.                                                                               |
| FR-9.4  | The system shall provide crash recovery: worktree preserved, session resumable from SQLite, only in-progress task needs restart.                                                  |
| FR-9.5  | The system shall route feedback payloads to the originating agent session via Mastra session resume.                                                                              |
| FR-9.6  | The system shall provide agent controls at group level: Start, Pause, Resume, Stop, Restart (with notes).                                                                         |
| FR-9.7  | The system shall support auto-start mode (workspace setting): groups automatically activate when dependencies resolve.                                                            |
| FR-9.8  | The system shall emit fleeting memories during agent execution (SQLite), with synthesis/triage at task group boundaries.                                                          |
| FR-9.9  | The system shall provide agent execution visibility: project overview (which agents running), dependency graph (task statuses), task detail Log tab (real-time execution stream). |
| FR-9.10 | The system shall stream execution logs via WebSocket to the UI.                                                                                                                   |

**Exit Criteria:** Mastra integration. Persistent agent sessions. Crash recovery. Feedback routing to sessions. Auto-start mode. Execution log streaming.

### 6.12 M10: Dev Containers

**Description:** Optional per-workspace Docker containers provide sandboxed execution for async agents. Agents run with full permissions inside a network-firewalled container, eliminating manual permission approvals for unattended workflows.\
**Priority:** Low

**Stimulus/Response:**

| Trigger                                      | System Behavior                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Task group activates with containers enabled | Client daemon checks if workspace container is running; if not, builds/starts from Engy base image + workspace overrides |
| Last agent session completes                 | Idle timer starts; container stops after configurable timeout if no new sessions                                         |
| Agent makes network request                  | Firewall allows only domains in base allowlist + workspace-defined additions; all other traffic blocked                  |

**Functional Requirements:**

| ID       | Requirement                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-10.1  | The system shall support optional, per-workspace Docker containers enabled via workspace settings.                                                           |
| FR-10.2  | The system shall manage container lifecycle on-demand: start when task group activates, stop after configurable idle timeout.                                |
| FR-10.3  | The system shall provide one container per workspace with all configured repos bind-mounted.                                                                 |
| FR-10.4  | The system shall bind-mount repos with main branch read-only and worktrees read-write.                                                                       |
| FR-10.5  | The system shall implement a network firewall using iptables with ipset allowlists inside the container (`NET_ADMIN` / `NET_RAW` capabilities).              |
| FR-10.6  | The system shall provide a base network allowlist: Anthropic API, GitHub, npm registry.                                                                      |
| FR-10.7  | The system shall allow workspace-defined additions to the network allowlist (custom registries, external APIs).                                              |
| FR-10.8  | The system shall provide workspace settings for container configuration: enabled flag, allowed domains, extra packages, environment variables, idle timeout. |
| FR-10.9  | The system shall display container status on the project overview (running, starting, stopped).                                                              |
| FR-10.10 | The system shall fall back to direct (non-containerized) execution when containers are disabled.                                                             |

**Exit Criteria:** Docker containers start/stop on demand. Network firewall with allowlist. Bind-mounted repos. Container status in UI. Fallback to direct execution.

### 6.13 M11: PR/CI Monitoring

**Description:** Automated monitoring of open PRs — CI status polling, CI failure auto-fix dispatch, and reviewer comment triage with selective fix dispatch.\
**Priority:** Low

**Stimulus/Response:**

| Trigger                                         | System Behavior                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PR CI check fails                               | System creates notification, dispatches agent for mechanical fixes (lint, type errors, missing deps) |
| Agent fixes CI failure                          | New diffs appear in diff viewer for review                                                           |
| Reviewer leaves comments on PR                  | System pulls comments into diff viewer for triage                                                    |
| User selects comments and clicks "Fix Selected" | System dispatches agent with selected comments as context                                            |
| Unresolvable CI failure                         | System notifies user                                                                                 |

**Functional Requirements:**

| ID      | Requirement                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| FR-11.1 | The system shall provide a Project PRs tab listing open PRs across repos with CI status per PR.                                 |
| FR-11.2 | The system shall poll PR status via `gh` CLI (status, checks, reviews, comments).                                               |
| FR-11.3 | The system shall auto-dispatch agents for mechanical CI fixes (lint, type errors, missing deps).                                |
| FR-11.4 | The system shall display new diffs after agent CI fixes for review (same approve/feedback loop).                                |
| FR-11.5 | The system shall pull reviewer comments from GitHub into the diff viewer context.                                               |
| FR-11.6 | The system shall allow users to select which reviewer comments to address and dispatch agent with selected comments as context. |
| FR-11.7 | The system shall support dismissing unselected reviewer comments or responding manually.                                        |
| FR-11.8 | The system shall notify the user for unresolvable CI failures.                                                                  |

**Exit Criteria:** PRs tab with CI status. Auto-dispatch for CI fixes. Reviewer comment triage with selective fix dispatch.

### 6.14 Phasing / Deferral

| ID | Requirement                          | Deferred To | Reason                                                                            |
| -- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------- |
| —  | Multi-user collaboration             | Post-v1     | Single-user-first design; architecture supports future multi-user without rewrite |
| —  | GitLab/Bitbucket support             | Post-v1     | GitHub only via `gh` CLI                                                          |
| —  | Self-hosting distribution/packaging  | Post-v1     | Developer tool, runs from source                                                  |
| —  | Cross-workspace project coordination | Post-v1     | Manual coordination sufficient for v1                                             |

***

## 7. File Map & Implementation Sequence

***

## 8. Key Decisions

1. **Single-user first.** No authentication, no multi-tenancy. Architecture should support future multi-user without a rewrite, but it is not a design constraint today.

2. **Two AI runtimes.** Claude Code CLI for interactive work (terminal), Claude Agent SDK via Mastra for autonomous background execution. The split keeps interactive work snappy while heavy lifting runs in the background.

3. **Knowledge in files, execution in database.** `.engy/` files (git-tracked) hold permanent knowledge; SQLite holds transient execution state. qmd indexes both but is always rebuildable from source files.

4. **Server never touches user repos directly.** Path validation delegated to client daemon via WebSocket. Enables remote server deployment.

5. **Progressive planning.** Project → milestones (rough scope) → groups/tasks (detailed) → task-level plan (optional). Plan just-in-time with maximum context.

6. **Task groups as the shippable unit.** One worktree, one branch, one agent session, one PR per group. Regrouping after activation requires stop + re-plan.

7. **Batched review model everywhere.** Diffs and documents both use: review → comment → approve or send feedback. One model, two renderings.

8. **Specs are living documents.** Editable at any time during project execution. No artificial freezing.

9. **Short-lived project assumption.** Projects complete in days to weeks. Scope tightly, split large efforts, complete aggressively.

10. **Dev containers are optional.** The system works without containers (standard Claude Code permission model). Containers add network-firewalled sandbox for unattended agent execution.

***

## 9. Out of Scope (v1)

| Feature                              | Reason                         |
| ------------------------------------ | ------------------------------ |
| Multi-user collaboration             | Single-user-first              |
| GitLab/Bitbucket support             | GitHub only via `gh` CLI       |
| Self-hosting distribution/packaging  | Runs from source               |
| Cross-workspace project coordination | Manual coordination sufficient |

***

## 10. Dependencies

Core technology stack — packages and tools required across milestones:

| Package/Tool                 | Target            | Purpose                                                                                          |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Next.js 16                   | web               | App Router, React 19, server + client rendering                                                  |
| Drizzle ORM + better-sqlite3 | web               | SQLite database with WAL mode                                                                    |
| tRPC v11                     | web               | Type-safe API for browser UI                                                                     |
| MCP SDK                      | web               | AI agent access layer (SSE + HTTP POST)                                                          |
| BlockNote                    | web               | Rich markdown editor for specs/docs                                                              |
| xterm.js                     | web               | Terminal emulator for Claude Code CLI panel                                                      |
| shadcn/ui                    | web               | Component library (lyra style, zinc base)                                                        |
| Tailwind CSS v4              | web               | Styling                                                                                          |
| TanStack Query v5            | web               | Data fetching + caching                                                                          |
| qmd (`@tobilu/qmd`)          | web               | Hybrid search for knowledge layer (BM25 + vector + LLM reranking, local-only via node-llama-cpp) |
| chokidar                     | client            | File system watching                                                                             |
| Mastra                       | client            | Agent SDK runtime for async agents                                                               |
| Docker                       | client (optional) | Dev container runtime                                                                            |
| `gh` CLI                     | client            | GitHub PR operations                                                                             |

***

## 11. Verification

> Milestone-level verification checklists live in each milestone's plan document. This section defines the system-level acceptance criteria.

1. `pnpm blt` passes (build + lint + test + knip + jscpd) at every milestone

2. Server test coverage meets thresholds: 90% statements, 85% branches, 90% functions, 90% lines

3. Full SDD loop functional end-to-end after M9: spec → project → plan → execute → review → commit → PR → complete

4. Knowledge feedback loop closed after M7: project completion → memory distillation → system doc updates

5. Terminal panel functional on every page after M4 with context-scoped auto-start

6. Dev containers (M10) optional — system works identically without them

***

## 12. Open Questions

| # | Question                                                                                                       | Owner | Status                                                                    |
| - | -------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| 1 | ~~How should ChromaDB be deployed — embedded in the server process or as a sidecar?~~                          | Aleks | Resolved (replaced with qmd — runs in-process via SDK, no sidecar needed) |
| 2 | Should archived projects be fully deletable, or kept as permanent references?                                  | Aleks | Resolved (deletable)                                                      |
| 3 | What is the optimal idle timeout default for dev containers?                                                   | Aleks | Open                                                                      |
| 4 | Should system doc update proposals from project completion be auto-generated or require explicit user trigger? | Aleks | Resolved (auto-generated, user reviews)                                   |

***

## 13. Revision History

| Date       | Author | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                              | Version |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 2026-03-01 | Aleks  | Initial draft — full SRS from vision spec + milestones                                                                                                                                                                                                                                                                                                                                                                                               | 0.1     |
| 2026-03-01 | Aleks  | Validation pass: added missing definitions (Shared Docs, Fleeting Memory, Project Memory, Plan Content, ChromaDB, Mastra, Claude Code Skill), added missing FRs (FR-1.11, FR-2.13, FR-3.14, FR-3.15, FR-4.12, FR-5.11, FR-5.12, FR-6.12, FR-7.16, FR-7.17, FR-7.18), expanded FR-4.7 terminal context mapping, corrected Memory definition subtypes, updated milestone FR ranges. Added mobile/responsive support (NF-18, responsive layout in 3.1). | 0.2     |
| 2026-03-11 | Aleks  | Restructured: removed Definitions section, removed System Features section, consolidated FRs with stimulus/response under milestones, removed Features Included from milestone table, renumbered sections.                                                                                                                                                                                                                                           | 0.3     |
| 2026-03-23 | Aleks  | M7: Replaced ChromaDB with qmd (`@tobilu/qmd`) as the search SDK. qmd provides hybrid search (BM25 + vector + LLM reranking) running entirely local via node-llama-cpp — eliminates the external service dependency. Updated FRs 7.7–7.9, architecture diagram, interfaces, dependencies, and resolved open question #1.                                                                                                                             | 0.4     |
| 2026-03-23 | Aleks  | Validation pass: fixed missed ChromaDB reference in NF-12 (section 4.3 Reliability) — updated to reference qmd search index, consistent with the v0.4 migration.                                                                                                                                                                                                                                                                                     | 0.4.1   |
| 2026-03-23 | Aleks  | FR-7.17: Added keywords, themes, and supersededBy fields to permanent memory schema (aligned with M7 plan and v1 memory spec). | 0.5 |
