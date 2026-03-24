---
title: Project Planning
status: complete
---

# Plan: M4 Project Planning

## Context

**M1 (Foundation)** shipped the skeleton: web + client daemon over WebSocket, SQLite/Drizzle schema (workspaces, projects, milestones, task_groups, tasks, agent_sessions, fleeting_memories, project_memories, plan_content, comments, comment_threads, thread_comments), tRPC API with full CRUD, MCP server, and a navigation shell with empty-state tabs.

**M2 (Spec Authoring)** shipped the specs tab: file tree, BlockNote editor, YAML frontmatter, spec lifecycle (draft -> ready -> approved), inline comments via comment threads, spec tasks, file watcher, MCP spec tools, and the `docsDir` per-workspace feature.

**M3 (Open Directory)** shipped lightweight quick-open mode: open any directory from Home, browse/edit markdown files, `dir` tRPC router, recent directories in localStorage.

**M4 (Project Planning)** delivers the spec-to-project transition and the full planning model with visual project views.

### Explicitly Out of Scope for M4

- Terminal panel / xterm.js (M5)
- Diff viewer (M6)
- Worktree management (M7)
- Knowledge/memory layer (M8)
- PR monitoring (M12)
- Agent sessions / async execution (M10)
- Auto-start mode for task groups
- Activity feed (M9)
- Notifications (M9)
- Global search / ChromaDB (M8/M9)

---

## New/Modified File Map

```
web/src/
├── server/
│   ├── trpc/
│   │   └── routers/
│   │       ├── project.ts                         # MODIFY: add createFromSpec, getBySlug, listWithProgress, updateStatus validation
│   │       ├── project.test.ts                    # MODIFY: add tests for new procedures
│   │       ├── milestone.ts                       # MODIFY: add status transition validation, reorder, update scope
│   │       ├── milestone.test.ts                  # MODIFY: add transition validation tests
│   │       ├── task-group.ts                      # MODIFY: add status tracking, list with task counts
│   │       ├── task-group.test.ts                 # MODIFY: add status tests
│   │       ├── task.ts                            # MODIFY: add listByProject (with milestones/groups), bulk operations
│   │       ├── task.test.ts                       # MODIFY: add new procedure tests
│   │       ├── plan-content.ts                    # NEW: plan content CRUD router
│   │       ├── plan-content.test.ts               # NEW
│   │       └── spec.ts                            # MODIFY: add createProject action (approved -> active transition)
│   │   └── root.ts                                # MODIFY: register planContent router
│   ├── mcp/
│   │   └── index.ts                               # MODIFY: add project planning MCP tools
│   └── spec/
│       └── service.ts                             # MODIFY: add createProjectFromSpec helper
.claude/skills/
├── engy-project-assistant.md                      # NEW: Claude Code skill for project planning
├── engy-workspace-assistant.md                    # NEW: Claude Code skill for default project work
└── engy-planning.md                               # NEW: Claude Code skill for progressive planning loops
├── app/
│   ├── w/[workspace]/
│   │   ├── page.tsx                               # MODIFY: workspace overview with project cards
│   │   ├── tasks/page.tsx                         # MODIFY: default project Eisenhower matrix
│   │   └── projects/[project]/
│   │       ├── page.tsx                           # NEW: project overview tab (redirects to overview)
│   │       ├── layout.tsx                         # NEW: project page layout with tabs
│   │       ├── overview/page.tsx                  # NEW: project overview content
│   │       ├── tasks/page.tsx                     # NEW: project tasks (3 views)
│   │       └── plan/page.tsx                      # NEW: project plan tab
│   └── w/[workspace]/specs/page.tsx               # MODIFY: enable "Create Project" button on approved specs
├── components/
│   ├── projects/
│   │   ├── project-overview.tsx                   # NEW: project overview component
│   │   ├── milestone-list.tsx                     # NEW: milestone list with status/actions
│   │   ├── milestone-form.tsx                     # NEW: create/edit milestone dialog
│   │   ├── task-views/
│   │   │   ├── dependency-graph.tsx               # NEW: task dependency graph visualization
│   │   │   ├── swimlane-board.tsx                 # NEW: milestone swimlane board
│   │   │   ├── eisenhower-matrix.tsx              # NEW: Eisenhower matrix (reusable)
│   │   │   └── view-toggle.tsx                    # NEW: view mode toggle
│   │   ├── task-detail-panel.tsx                  # NEW: slide-out task detail
│   │   ├── task-form.tsx                          # NEW: create/edit task dialog
│   │   ├── task-group-form.tsx                    # NEW: create task group dialog
│   │   ├── plan-editor.tsx                        # NEW: plan content editor per milestone
│   │   └── create-project-dialog.tsx              # NEW: create project from spec dialog
│   ├── workspace/
│   │   ├── workspace-overview.tsx                 # NEW: overview tab content (project cards + progress)
│   │   └── project-card.tsx                       # NEW: project summary card with progress bar
│   └── ui/
│       ├── progress.tsx                           # NEW: shadcn progress bar
│       └── sheet.tsx                              # NEW: shadcn sheet (for slide-out panel)
```

---

## Functional Requirements

### Project Lifecycle (FR 1-7)

1. **Create Project from Spec**: Given an approved spec, the system shall create a new project in SQLite with: `workspaceId` from the spec's workspace, `name` from the spec title, `slug` auto-generated, `specPath` set to the spec directory path, `status` = `planning`. The spec's status shall be updated to `active`. The system shall return the created project.

2. **Project status transitions**: The system shall validate project status transitions: `planning` -> `active` -> `completing` -> `archived`. Invalid transitions shall be rejected with a descriptive error.

3. **Get project by slug**: The system shall support looking up a project by `workspaceId` + `slug` (for URL-based navigation at `/w/{workspace}/projects/{project}`).

4. **List projects with progress**: The system shall return projects for a workspace with computed progress data: milestone count, completed milestone count, total task count, completed task count.

5. **Default project**: Each workspace has exactly one project with `isDefault = true`. The workspace Tasks tab operates on this project's tasks (no milestones, no groups — flat Eisenhower matrix).

6. **Project page routing**: Projects are accessible at `/w/{workspace}/projects/{project}` with tabs: Overview, Tasks, Plan. Diffs and PRs tabs are rendered but disabled with "Coming in M6/M12" tooltips.

7. **Create Project action on Specs tab**: The "Create Project" button on the spec frontmatter bar shall be enabled when the spec is in `approved` status. Clicking it opens a confirmation dialog, then creates the project and navigates to `/w/{workspace}/projects/{project-slug}`.

### Milestone Management (FR 8-14)

8. **Milestone CRUD**: The system shall support creating milestones with: `projectId`, `title`, `scope` (description text), `sortOrder`. Milestones are returned ordered by `sortOrder`.

9. **Milestone status transitions**: The system shall validate: `planned` -> `planning` -> `active` -> `complete`. Only forward transitions are allowed. Invalid transitions (e.g., `planned` -> `active` skipping `planning`) shall be rejected.

10. **Milestone reorder**: The system shall support reordering milestones by accepting an array of `{ id, sortOrder }` pairs. Already implemented in `milestone.ts`.

11. **Plan Milestone action**: When a milestone is in `planned` or `planning` status, the UI shall display a "Plan Milestone" button. In M4, this transitions the milestone to `planning` status (the terminal-based planning flow comes in M5).

12. **Milestone progress**: The system shall compute milestone progress as: completed tasks / total tasks within that milestone. Milestones with zero tasks show 0%.

13. **Milestone scope editing**: The `scope` field on milestones is editable inline from the overview and plan tab.

14. **Milestone deletion**: Deleting a milestone cascade-deletes its task groups and tasks (via DB foreign key cascades already in schema).

### Task Group Management (FR 15-18)

15. **Task group CRUD**: Already implemented. The system shall additionally support listing task groups with their task counts and completion status.

16. **Task group status tracking**: Task group status (`planned`, `active`, `review`, `complete`) is already in the schema. The update procedure already supports status changes. M4 adds UI for viewing status.

17. **Task group assignment**: Tasks can be assigned to a task group via `task.update` with `taskGroupId`. Already implemented.

18. **Task group display**: Each task group shows: name, status badge, task count, completed task count, assigned repos list.

### Task Management (FR 19-26)

19. **Task CRUD under milestones**: Tasks can be created with `milestoneId` and optionally `taskGroupId`. Already implemented in `task.create`.

20. **Task dependencies**: Tasks can reference other tasks via the `dependencies` array. Cycle detection via `detectCycle()` is already implemented. M4 adds UI for viewing and setting dependencies.

21. **Task detail panel**: A slide-out panel (Sheet) showing task details: title, description, status, type (AI/Human), importance, urgency, milestone, group assignment, dependencies (with status badges).

22. **Task status updates**: Status transitions (`todo` -> `in_progress` -> `review` -> `done`) via the existing `task.update` mutation. M4 adds quick-toggle UI.

23. **Task creation dialog**: A dialog for creating tasks with: title (required), description, type, importance, urgency, dependencies (multi-select from existing tasks), milestone assignment, group assignment.

24. **Eisenhower matrix for default project**: The workspace Tasks tab shows tasks from the default project in a 4-quadrant matrix (urgent+important, urgent+not_important, not_urgent+important, not_urgent+not_important). Tasks are draggable between quadrants to change importance/urgency.

25. **List tasks by project with hierarchy**: A query that returns all tasks for a project, grouped by milestone and task group, for building the dependency graph and swimlane views.

26. **Task filtering**: On the project Tasks tab, tasks can be filtered by: status, type, milestone, task group.

### Task Views (FR 27-30)

27. **Dependency graph**: Tasks displayed as nodes in a directed graph. Edges represent dependencies. Task groups are visual clusters (background color). Nodes are color-coded by status (todo=gray, in_progress=blue, review=yellow, done=green). Clicking a node opens the task detail panel. Implementation: use a simple CSS/SVG-based layout with topological sorting, no heavy graph library needed for M4.

28. **Swimlane board**: Milestones as horizontal lanes. Task groups as cards within each lane. Each card shows group name, status, task count. Compact overview of project structure.

29. **Eisenhower matrix (project)**: Same as the default project matrix but scoped to the selected project's tasks. Available as a view toggle on the project Tasks tab.

30. **View toggle**: A segmented control with three options: Dependency Graph (default), Swimlane, Eisenhower. Persisted in URL search params (`?view=graph|swimlane|eisenhower`).

### Plan Tab (FR 31-34)

31. **Plan content storage**: The `plan_content` table (already in schema) stores markdown content per milestone. Each milestone can have one plan_content entry.

32. **Plan content CRUD**: A new tRPC router (`planContent`) with: `get` (by milestoneId), `upsert` (create or update by milestoneId), `delete`.

33. **Plan tab UI**: Displays the project's spec link, then lists milestones in order. Each milestone shows: title, status badge, plan content (rendered markdown or editor), task groups and their tasks. Milestones without plan content show a "No plan yet" placeholder.

34. **Plan content editing**: Clicking a milestone's plan section in the Plan tab opens an inline BlockNote editor for editing plan content. Auto-saves with 1500ms debounce. Same editor component as specs.

### Workspace Overview Enhancement (FR 35-37)

35. **Workspace Overview tab**: Replace the current minimal workspace overview with project cards. Show: default project summary (active task count), non-default project cards with progress bars, spec link.

36. **Project cards**: Each card shows: project name, status badge, progress bar (based on task completion), milestone fraction (e.g., "3/5 milestones"), click navigates to project page.

37. **Default project summary**: A compact card showing the count of active tasks in the default project, with a "View Tasks" link to the workspace Tasks tab.

### MCP Tools (FR 38-41)

38. **createProjectFromSpec**: MCP tool that creates a project from an approved spec (same logic as FR 1).

39. **planMilestone**: MCP tool that updates a milestone's plan content and optionally transitions it to `planning` status.

40. **listProjectTasks**: MCP tool that returns all tasks for a project with milestone/group hierarchy.

41. **getProjectOverview**: MCP tool that returns project details with milestone progress, task counts, and status summary.

### Skills (FR 42-44)

42. **engy:project-assistant**: Claude Code skill file (`.claude/skills/engy-project-assistant.md`) for milestone planning, group creation, and task decomposition from spec. References MCP tools: `createMilestone`, `createTaskGroup`, `createTask`, `planMilestone`, `getProjectOverview`, `listProjectTasks`. Guides the user through: spec review -> milestone decomposition -> group/task creation -> plan content authoring.

43. **engy:workspace-assistant**: Claude Code skill file (`.claude/skills/engy-workspace-assistant.md`) for quick bugs and one-offs on the default project. References MCP tools: `createTask`, `updateTask`, `listTasks`. Guides the user through: describe bug/task -> create task with appropriate priority -> track completion.

44. **engy:planning**: Claude Code skill file (`.claude/skills/engy-planning.md`) for guided progressive planning loops. Walks through: project-level planning (milestones from spec) -> milestone-level planning (groups and tasks from scope) -> task-level planning (plan content per milestone). References all project/milestone/task MCP tools.

---

## Behavioral Requirements

### Project Lifecycle

```gherkin
Feature: Project creation from spec
  Approved specs can be converted to projects.

  Scenario: Create project from approved spec (FR #1)
    Given a workspace "engy" with an approved spec "auth-revamp"
    When I create a project from the spec
    Then a project is created with name "Auth Revamp" and specPath "auth-revamp"
    And the project status is "planning"
    And the spec status is updated to "active"

  Scenario: Cannot create project from non-approved spec (FR #1)
    Given a spec "auth-revamp" in "draft" status
    When I attempt to create a project from the spec
    Then the operation fails with "spec must be in approved status"

  Scenario: Cannot create project from spec that already has a project (FR #1)
    Given a spec "auth-revamp" in "active" status (already has a project)
    When I attempt to create a project from the spec
    Then the operation fails with "spec already has an associated project"

  Scenario: Valid project status transitions (FR #2)
    Given a project in "planning" status
    When I update status to "active"
    Then the status is updated to "active"

  Scenario: Invalid project status transition rejected (FR #2)
    Given a project in "planning" status
    When I update status to "archived" (skipping active, completing)
    Then the operation fails with "invalid status transition"

  Scenario: Get project by slug (FR #3)
    Given a workspace "engy" with project slug "auth-revamp"
    When I call project.getBySlug({ workspaceId: 1, slug: "auth-revamp" })
    Then it returns the project

  Scenario: List projects with progress (FR #4)
    Given a workspace with 2 projects, each having milestones and tasks
    When I call project.listWithProgress({ workspaceId: 1 })
    Then each project includes milestoneCount, completedMilestones, taskCount, completedTasks
```

### Milestone Status Transitions

```gherkin
Feature: Milestone status transitions
  Milestones follow a linear status progression.

  Scenario: Valid forward transition (FR #9)
    Given a milestone in "planned" status
    When I update status to "planning"
    Then the status is updated

  Scenario: Skip transition rejected (FR #9)
    Given a milestone in "planned" status
    When I update status to "active" (skipping "planning")
    Then the operation fails with "invalid milestone status transition"

  Scenario: Backward transition rejected (FR #9)
    Given a milestone in "active" status
    When I update status to "planned"
    Then the operation fails with "invalid milestone status transition"

  Scenario: Complete transition (FR #9)
    Given a milestone in "active" status
    When I update status to "complete"
    Then the status is updated

  Scenario: Milestone progress calculation (FR #12)
    Given a milestone with 4 tasks: 2 done, 1 in_progress, 1 todo
    When I query the milestone
    Then progress is 50% (2/4)

  Scenario: Milestone with no tasks (FR #12)
    Given a milestone with 0 tasks
    When I query the milestone
    Then progress is 0%
```

### Task Views

```gherkin
Feature: Task dependency graph
  Visual representation of task dependencies.

  Scenario: Graph renders tasks with dependencies (FR #27)
    Given tasks T1, T2, T3 where T3 depends on T1 and T2
    When the dependency graph renders
    Then T1 and T2 appear as root nodes
    And T3 appears with edges from T1 and T2
    And nodes are color-coded by status

  Scenario: Task groups as visual clusters (FR #27)
    Given tasks T1, T2 in group "backend" and T3 in group "frontend"
    When the dependency graph renders
    Then T1 and T2 share a cluster background
    And T3 has a different cluster background

  Scenario: Clicking a node opens task detail (FR #21, #27)
    Given the dependency graph is displayed
    When I click on task T1
    Then the task detail panel slides out with T1's details
```

```gherkin
Feature: Swimlane board
  Milestones as lanes with task group cards.

  Scenario: Lanes display milestones in order (FR #28)
    Given a project with milestones M1 (sortOrder 0) and M2 (sortOrder 1)
    When the swimlane board renders
    Then M1 appears above M2
    And each lane shows task group cards

  Scenario: Task group cards show status (FR #28)
    Given milestone M1 with groups "backend" (active, 3 tasks) and "frontend" (planned, 2 tasks)
    When the swimlane board renders
    Then "backend" card shows "Active" badge and "3 tasks"
    And "frontend" card shows "Planned" badge and "2 tasks"
```

```gherkin
Feature: Eisenhower matrix
  4-quadrant task prioritization view.

  Scenario: Tasks appear in correct quadrants (FR #24)
    Given task T1 (important, urgent) and T2 (not_important, not_urgent)
    When the Eisenhower matrix renders
    Then T1 appears in the "Urgent + Important" quadrant
    And T2 appears in the "Not Urgent + Not Important" quadrant

  Scenario: Default project tasks tab (FR #5, #24)
    Given a workspace with default project having 4 tasks of varying priority
    When I navigate to the workspace Tasks tab
    Then the Eisenhower matrix displays all 4 tasks in their correct quadrants
```

### Plan Content

```gherkin
Feature: Plan content management
  Milestone-level plan content for progressive planning.

  Scenario: Create plan content for a milestone (FR #31, #32)
    Given a milestone M1 with no plan content
    When I upsert plan content "## Implementation\nStep 1..."
    Then plan_content table has an entry with milestoneId = M1.id

  Scenario: Update existing plan content (FR #32)
    Given a milestone M1 with existing plan content
    When I upsert new content
    Then the existing entry is updated (not duplicated)

  Scenario: Plan tab displays milestone hierarchy (FR #33)
    Given a project with 3 milestones, 2 with plan content
    When I view the Plan tab
    Then all 3 milestones are listed in order
    And 2 show their plan content
    And 1 shows "No plan yet" placeholder

  Scenario: Edit plan content inline (FR #34)
    Given the Plan tab is displayed
    When I click to edit milestone M1's plan
    Then a BlockNote editor appears with the current content
    And changes auto-save after 1500ms
```

### Workspace Overview

```gherkin
Feature: Workspace overview with project cards
  The overview tab shows all projects with progress.

  Scenario: Default project summary (FR #37)
    Given a workspace with a default project having 3 active tasks
    When I view the workspace Overview tab
    Then I see "Default Project" card with "3 active tasks"

  Scenario: Project cards with progress (FR #36)
    Given 2 non-default projects with varying completion
    When I view the workspace Overview tab
    Then each project shows a progress bar and milestone fraction

  Scenario: Click project card navigates to project (FR #36)
    Given a project card for "auth-revamp"
    When I click the card
    Then I navigate to /w/{workspace}/projects/auth-revamp
```

### Create Project from Specs Tab

```gherkin
Feature: Create Project button on spec
  The spec frontmatter bar has a Create Project action.

  Scenario: Button enabled on approved spec (FR #7)
    Given a spec in "approved" status
    When I view the spec
    Then the "Create Project" button is enabled

  Scenario: Button disabled on non-approved spec (FR #7)
    Given a spec in "draft" status
    When I view the spec
    Then the "Create Project" button is disabled

  Scenario: Creating project from spec (FR #7)
    Given a spec "auth-revamp" in "approved" status
    When I click "Create Project"
    Then a confirmation dialog appears
    When I confirm
    Then a project is created
    And the spec status changes to "active"
    And I navigate to the project page
```

---

## Implementation Phases

### Phase 1: Server — Project Lifecycle Enhancement

**Files**: `web/src/server/trpc/routers/project.ts`, `web/src/server/trpc/routers/project.test.ts`, `web/src/server/spec/service.ts`, `web/src/server/trpc/routers/spec.ts`, `web/src/server/trpc/routers/spec.test.ts`

**TDD Steps:**
1. Write tests for `project.getBySlug` — look up project by workspaceId + slug.
2. Write tests for `project.listWithProgress` — returns projects with milestone/task progress counts.
3. Write tests for `project.updateStatus` — validate transition: planning -> active -> completing -> archived. Reject invalid transitions.
4. Write tests for `spec.createProject` — creates project from approved spec, transitions spec to active, rejects non-approved specs, rejects specs that already have a project.
5. Implement all procedures. The `createProjectFromSpec` logic lives in `spec/service.ts` (checks spec status, creates project, updates spec status).
6. Run `pnpm blt`.

### Phase 2: Server — Milestone Status Validation

**Files**: `web/src/server/trpc/routers/milestone.ts`, `web/src/server/trpc/routers/milestone.test.ts`

**TDD Steps:**
1. Write tests for milestone status transition validation: planned -> planning -> active -> complete. Reject skips and backward transitions.
2. Add status transition validation to `milestone.update` — before applying the status update, check current status allows the requested transition.
3. Run `pnpm blt`.

### Phase 3: Server — Plan Content Router

**Files**: `web/src/server/trpc/routers/plan-content.ts`, `web/src/server/trpc/routers/plan-content.test.ts`, `web/src/server/trpc/root.ts`

**TDD Steps:**
1. Write tests for `planContent.get` (by milestoneId), `planContent.upsert` (create or update), `planContent.delete`.
2. Implement the router. `upsert` checks if a plan_content entry exists for the milestoneId — if yes, updates; if no, creates.
3. Register in `root.ts`.
4. Run `pnpm blt`.

### Phase 4: Server — MCP Tools

**Files**: `web/src/server/mcp/index.ts`

**TDD Steps:**
1. Add MCP tools: `createProjectFromSpec`, `planMilestone`, `listProjectTasks`, `getProjectOverview`.
2. Follow existing MCP tool patterns (mcpResult/mcpError helpers).
3. Run `pnpm blt`.

### Phase 5: UI — shadcn Components

**Files**: `web/src/components/ui/progress.tsx`, `web/src/components/ui/sheet.tsx`

1. Install shadcn components: `progress`, `sheet`.
2. Run `pnpm blt`.

### Phase 6: UI — Eisenhower Matrix Component

**Files**: `web/src/components/projects/task-views/eisenhower-matrix.tsx`, `web/src/app/w/[workspace]/tasks/page.tsx`

1. Build the Eisenhower matrix as a reusable component. Props: `tasks` array, `onTaskClick`, `onQuadrantDrop` (for importance/urgency changes).
2. Four quadrants: "Urgent + Important", "Urgent + Not Important", "Not Urgent + Important", "Not Urgent + Not Important".
3. Each task card shows: title, type badge, status badge.
4. Wire into workspace Tasks tab: fetch default project, fetch its tasks, render matrix.
5. Add "New Task" button that creates tasks in the default project.
6. Run `pnpm blt`.

### Phase 7: UI — Task Detail Panel

**Files**: `web/src/components/projects/task-detail-panel.tsx`, `web/src/components/projects/task-form.tsx`

1. Build task detail panel using shadcn Sheet. Shows: title, description, status, type, importance/urgency, milestone name, group name, dependencies (list with status badges).
2. Status can be changed via dropdown.
3. Build task creation dialog: title, description, type, importance, urgency, milestone select, group select, dependencies multi-select.
4. Run `pnpm blt`.

### Phase 8: UI — Project Page Layout + Overview

**Files**: `web/src/app/w/[workspace]/projects/[project]/layout.tsx`, `web/src/app/w/[workspace]/projects/[project]/page.tsx`, `web/src/app/w/[workspace]/projects/[project]/overview/page.tsx`, `web/src/components/projects/project-overview.tsx`, `web/src/components/projects/milestone-list.tsx`, `web/src/components/projects/milestone-form.tsx`

1. Create project layout with tabs: Overview, Tasks, Plan, Diffs (disabled), PRs (disabled).
2. Project overview: status, spec link, progress bar, milestone list.
3. Milestone list: ordered milestones with status badges, progress bars, "Plan Milestone" button.
4. Milestone creation dialog: title, scope, sortOrder.
5. Run `pnpm blt`.

### Phase 9: UI — Project Tasks Tab (Dependency Graph + Swimlane)

**Files**: `web/src/app/w/[workspace]/projects/[project]/tasks/page.tsx`, `web/src/components/projects/task-views/dependency-graph.tsx`, `web/src/components/projects/task-views/swimlane-board.tsx`, `web/src/components/projects/task-views/view-toggle.tsx`, `web/src/components/projects/task-group-form.tsx`

1. Build view toggle (segmented control): Graph, Swimlane, Eisenhower.
2. Build dependency graph: topological sort for layout, SVG edges, task nodes as cards. CSS-based layout (grid columns by depth). No external graph library.
3. Build swimlane board: milestone lanes (horizontal sections), task group cards within.
4. Wire Eisenhower matrix (from Phase 6) as third view option.
5. Task group creation dialog.
6. Run `pnpm blt`.

### Phase 10: UI — Plan Tab

**Files**: `web/src/app/w/[workspace]/projects/[project]/plan/page.tsx`, `web/src/components/projects/plan-editor.tsx`

1. Plan tab: spec link, milestone list in order, each with plan content.
2. Inline BlockNote editor for plan content (reuse DynamicDocumentEditor).
3. Auto-save via planContent.upsert mutation.
4. "Plan Milestone" button transitions milestone to planning status.
5. Run `pnpm blt`.

### Phase 11: UI — Workspace Overview Enhancement

**Files**: `web/src/app/w/[workspace]/page.tsx`, `web/src/components/workspace/workspace-overview.tsx`, `web/src/components/workspace/project-card.tsx`

1. Replace current workspace overview with project-card layout.
2. Default project summary card: active task count, link to Tasks tab.
3. Non-default project cards: name, status, progress bar, milestone fraction.
4. Clicking a card navigates to `/w/{workspace}/projects/{project-slug}`.
5. Run `pnpm blt`.

### Phase 12: UI — Create Project from Spec

**Files**: `web/src/app/w/[workspace]/specs/page.tsx`, `web/src/components/specs/spec-frontmatter.tsx`, `web/src/components/projects/create-project-dialog.tsx`

1. Enable "Create Project" button on spec frontmatter when spec status is `approved`.
2. Confirmation dialog: shows spec name, project name preview.
3. On confirm: call spec.createProject mutation, navigate to project page.
4. Run `pnpm blt`.

### Phase 13: Skills

**Files**: `.claude/skills/engy-project-assistant.md`, `.claude/skills/engy-workspace-assistant.md`, `.claude/skills/engy-planning.md`

1. Write `engy-project-assistant.md`: Claude Code skill for project planning. Lists available MCP tools (`createMilestone`, `createTaskGroup`, `createTask`, `planMilestone`, `getProjectOverview`, `listProjectTasks`, `getSpec`, `readSpecFile`), describes the project planning workflow (spec review -> milestone decomposition -> group/task creation -> plan content), provides step-by-step guidance.
2. Write `engy-workspace-assistant.md`: Claude Code skill for default project work. Lists task CRUD tools (`createTask`, `updateTask`, `listTasks`), describes the quick bug/task workflow (describe issue -> create task with priority -> track completion).
3. Write `engy-planning.md`: Claude Code skill for guided progressive planning loops. Describes the multi-level planning workflow (project-level: milestones from spec -> milestone-level: groups and tasks from scope -> plan content authoring). References all project/milestone/task/group MCP tools.
4. These are markdown files that Claude Code loads as skills — no code changes needed.
5. Run `pnpm blt` (skills don't affect build, but confirm nothing else broke).

### Phase 14: Tooling Polish

1. Run `pnpm blt` — fix any knip (unused exports), jscpd (copy-paste), or coverage issues.
2. Ensure all new routers have 90%+ test coverage.
3. Verify no TypeScript errors across the monorepo.

---

## Key Decisions

1. **Project page routing**: Projects live at `/w/{workspace}/projects/{project}` with nested routes for each tab. This matches the natural URL hierarchy (workspace > project > tab).

2. **Dependency graph implementation**: CSS grid-based layout with topological sorting, SVG for edges. No heavy graph library (like dagre, elkjs, or reactflow) in M4 — keeps the bundle small and avoids complex dependencies. If the graph needs more sophistication later (zooming, panning, auto-layout), we can add a library in a future milestone.

3. **Eisenhower matrix reuse**: Built as a standalone component that works for both the default project (workspace Tasks tab) and project-scoped tasks (project Tasks tab, Eisenhower view).

4. **Plan content model**: One plan_content entry per milestone (not per task). The `taskId` column in the existing schema is available for future use (task-level plans) but M4 only uses milestone-level plans.

5. **Milestone status validation**: Server-side enforcement of linear progression (planned -> planning -> active -> complete). No backward transitions. This prevents state inconsistencies.

6. **Project status validation**: Server-side enforcement of linear progression (planning -> active -> completing -> archived). Same rationale as milestones.

7. **Spec -> Project transition**: Atomic operation: create project + update spec status. If project creation fails, spec stays in `approved`. The spec's `specPath` stores the spec directory name, creating the bidirectional link.

8. **No drag-and-drop in M4**: The Eisenhower matrix and task views use click-based interactions only. Drag-and-drop for task reassignment/reordering is deferred to a future UX polish pass.

9. **Disabled tabs**: Diffs and PRs tabs are rendered but show disabled states with tooltips indicating which milestone will enable them. This sets user expectations without over-engineering.

---

## Out of Scope

| Feature | Milestone |
|---------|-----------|
| Terminal panel / xterm.js | M5 |
| Diff viewer | M6 |
| Worktree management | M7 |
| Knowledge/memory layer | M8 |
| Activity feed | M9 |
| Notifications | M9 |
| Global search | M8/M9 |
| Agent sessions / async execution | M10 |
| Auto-start mode for task groups | M10 |
| Drag-and-drop task reordering | Future |
| Real-time WebSocket updates to browser | Future |
| Task group lifecycle controls (Start/Pause/Stop) | M7 |
| PR monitoring | M12 |
| Mobile-responsive project views | M9 |

---

## Dependencies to Add

| Package | Target | Purpose |
|---------|--------|---------|
| `shadcn/progress` | web | Progress bar component (via `npx shadcn@latest add progress`) |
| `shadcn/sheet` | web | Slide-out panel for task detail (via `npx shadcn@latest add sheet`) |

No new npm packages needed beyond shadcn component additions. The dependency graph visualization uses CSS grid + SVG (no external library).

---

## Verification

1. `pnpm blt` passes (build + lint + test)
2. Create a workspace, approve a spec, create a project from it -> project page renders
3. Navigate to project Overview -> see milestone list, progress bar
4. Create milestones, set status transitions -> validation works
5. Navigate to Tasks tab -> dependency graph, swimlane, Eisenhower views work
6. Click a task node -> detail panel slides out
7. Navigate to Plan tab -> see milestone plan content, edit inline
8. Navigate to workspace Overview -> see project cards with progress
9. Workspace Tasks tab -> Eisenhower matrix with default project tasks
10. Create Project button on approved spec -> creates project, navigates to it
11. MCP tools: createProjectFromSpec, planMilestone, listProjectTasks, getProjectOverview all work
12. Skills: engy-project-assistant, engy-workspace-assistant, engy-planning skill files exist in .claude/skills/

---

## Plan Review

**Reviewer**: Automated cross-reference check against `docs/projects/initial/milestones.md` M4 section.

### Completeness Check

All 19 requirements from the M4 milestone spec are covered:

| Milestone Spec Requirement | Plan Coverage |
|---|---|
| "Create Project" action on approved specs | FR #1, #7, Phase 1, 12 |
| Project page with tabs (Overview, Tasks, Plan, Diffs/PRs disabled) | FR #6, Phase 8 |
| Project Overview: status, spec link, progress bar, milestones | Phase 8 |
| "Plan Milestone" action | FR #11, Phase 8, 10 |
| Project Tasks: Dependency graph (default) | FR #27, Phase 9 |
| Project Tasks: Swimlane board | FR #28, Phase 9 |
| Project Tasks: Eisenhower matrix | FR #29, Phase 6, 9 |
| Task detail panel (slide-out) | FR #21, Phase 7 |
| Plan tab: view/edit plan content per milestone | FR #31-34, Phase 10 |
| Milestone management (create, reorder, status transitions) | FR #8-14, Phase 2, 8 |
| Task group management (create, assign tasks, display status) | FR #15-18, Phase 9 |
| Task CRUD (create, dependencies, groups) | FR #19-26, Phase 7, 9 |
| Default project: Eisenhower matrix on workspace Tasks tab | FR #5, #24, Phase 6 |
| Workspace Overview: project cards with progress | FR #35-37, Phase 11 |
| Server: Project lifecycle management | FR #1-4, Phase 1 |
| Server: Milestone CRUD with ordering and status transitions | Phase 2 |
| Server: Task group CRUD with status tracking | FR #15-18 |
| Server: Task dependency validation (cycle detection) | Already exists |
| Server: Progressive planning support | FR #31-34, Phase 3 |
| Skills: engy:project-assistant | FR #42, Phase 13 |
| Skills: engy:workspace-assistant | FR #43, Phase 13 |
| Skills: Planning skill | FR #44, Phase 13 |

### Out-of-Scope Validation

No out-of-scope features were included. Terminal panel (M5), diff viewer (M6), worktree management (M7), knowledge layer (M8), async agents (M10), and PR monitoring (M12) are all explicitly excluded.

### Phase Ordering

Phases are logically ordered: server first (Phases 1-4), then UI components bottom-up (Phases 5-12), skills (Phase 13), polish last (Phase 14). Each phase is independently `pnpm blt`-green. No phase depends on a later phase.

### File Map Coverage

All functional requirements have corresponding files in the file map. New files are clearly marked (NEW) vs modified (MODIFY). Test files are included for all new server code.

### Issues Found

None. **LGTM.**
