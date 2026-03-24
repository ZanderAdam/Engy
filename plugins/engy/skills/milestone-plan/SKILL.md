---
name: engy:milestone-plan
description: "This skill should be used when the user asks to 'plan my project', 'plan milestones', 'break down into tasks', or 'create tasks for milestone'. Plans spec milestones in detail — task groups, tasks, dependencies, and priorities."
---

# Milestone Planner

The spec already contains a high-level list of milestones. This skill plans **one milestone at a time** in detail — defining task groups, individual tasks, dependencies, and priorities. Everything is presented to the user for approval before creating anything in the system.

## Multi-Repo Task Scoping

When a workspace manages multiple repos, task scoping rules apply:

- **Task groups** can span multiple repos — set their `repos` field to all repos the group's tasks touch.
- **Tasks must each target a single repo.** Never create a task that requires working across multiple repos simultaneously. Mention the target repo/package in the task title or description (e.g., "Implement auth middleware in `web/`").
- **Cross-repo dependencies** within a group use `blockedBy` — upstream repo tasks (e.g., shared types in `common/`) should be completed before downstream consumers (e.g., `web/`).

### Discovering Repos

Call `getProjectDetails(projectId)` and inspect `workspace.repos` (an array of local repo paths). If the array has more than one entry, apply the multi-repo rules above when planning task groups and tasks.

For single-repo workspaces, these rules are effectively no-ops — all tasks naturally target the same repo.

## Planning Levels

### Level 1: Identify Which Milestone to Plan

1. Get the project's `specDir` via `getProjectDetails`.
2. Read `{specDir}/spec.md` and extract the existing milestone list.
3. **Determine which milestone to plan:**
   - If the user specified a milestone, use that one.
   - Otherwise, check for existing milestone plan docs via `Glob("{specPath}/milestones/m*-*.plan.md")` or task groups via `listTaskGroups`. Find the **next unplanned milestone** in sequence.
4. Present the selected milestone and its scope to the user for confirmation before proceeding.

**Do NOT create task groups or tasks yet.** Level 1 is purely about selecting and confirming which milestone to plan.

**One milestone per run.** Do not plan multiple milestones unless the user explicitly asks.

### Level 2: Plan Milestone Details (Groups and Tasks)

For the selected milestone:

0. **Confirm the correct projectId.** Use `listProjects` to find the project whose `specDir` matches the spec you're working with. Do NOT assume projectId=1.
1. **Discover workspace repos.** Call `getProjectDetails(projectId)` and check `workspace.repos`. If the workspace has multiple repos, apply the multi-repo task scoping rules (see above) throughout the remaining steps.
2. Review the milestone scope against the spec.
3. Break the milestone into **task groups**. Each group is a single deliverable — think one PR. Groups are ordered so they can be reviewed and merged as stacked PRs, making large milestones easier to review incrementally. For multi-repo workspaces, set the `repos` field on each group to the repos its tasks touch. **For each group, define its functional requirements** using hierarchical numbering (e.g., `FR-DC.1` for Dev Containers group). FRs live under each TG, not at the top level — this keeps each group self-contained for agent dispatch.
4. Within each group, define 1 or more tasks that together produce that deliverable. Follow the vertical slicing and granularity guidelines below. **Each task must target a single repo** — include the target repo/package in the task title or description (e.g., "Implement auth middleware in `web/`"). For cross-repo dependencies, use `blockedBy` to order upstream tasks before downstream consumers.
5. For each task, specify:
   - Title and description (including target repo for multi-repo workspaces)
   - **File ownership** — list the files this task creates or modifies. This is critical for parallel execution: agents need to know what they own and what siblings touch.
   - **Acceptance criteria** — derived from the task group's FRs. These are what the implementer tests against.
   - **FR references** — which FRs this task implements (e.g., "Implements FR-TG1.1, FR-TG1.2")
   - Type (`ai` or `human`)
   - Importance and urgency (using the Eisenhower matrix)
   - Dependencies on other tasks (`blockedBy`)
6. **Present the full breakdown to the user and wait for explicit approval.**
7. Write the milestone plan document (`m{N}-{slug}.plan.md` with `status: draft`) using the template below. This doc *is* the presentation — approval happens on this doc.
8. **Stop and wait** for the user to request TG planning (e.g., "plan TG1 stories").

### Task Group Planning

When the user asks to plan a specific TG:

1. Read the milestone doc's TG section (requirements, task outline, file ownership) as context. Update milestone doc status to `planning` if still `draft`.
2. For each task in the TG, run `/engy:plan` to produce a detailed implementation plan.
3. Create the task group and tasks via `createTaskGroup` / `createTask`.
   - Set `milestoneRef` on every task (e.g., `"m3"`) to link it to the milestone.
   - Set `specId` to the spec directory name so the task resolves to the correct spec path.
   - For multi-repo workspaces, pass the `repos` array when calling `createTaskGroup`.
   - Set `needsPlan: false` — tasks already have detailed plans from step 2.
   - Store the plan doc path on each task description.
4. Verify structure via `listTasks` and `listTaskGroups`.
5. When all TGs are planned and created, update milestone doc status to `complete`.

## Vertical Slicing

**Use vertical slices, not horizontal layers.** Each task should deliver a thin, end-to-end slice of functionality that touches all necessary layers (database, service, API, UI). A good slice is small but complete — something that can be tested and verified independently.

Bad (horizontal): "Create all database tables" then "Build all API endpoints" then "Add all UI components"

Good (vertical): "User can create a task and see it in a list" then "User can mark a task complete" then "User can filter tasks by status"

### Execution Order Within a Slice

Within each vertical slice, order subtasks as:
1. Schema / data model changes
2. Data access layer (repositories / queries)
3. Service / business logic
4. API endpoints
5. UI components
6. Integration tests

## Task Granularity

- **Target size**: 1-4 hours of work, or 5-8 concrete implementation steps
- **Maximum**: 6 tasks per feature/story
- **Minimum viable**: Each task must produce something testable
- **Context budget**: Tasks should complete within ~10-20 minutes of autonomous agent work
- If a task has more than 8 steps, split it. If it has fewer than 3 steps, combine with related work.

## Task Quality Checklist

Each task should be:
- **Well-scoped for planning**: A `/engy:plan` pass with the task description + milestone plan context should produce a complete implementation plan. The milestone task defines *what* and *where*; the planning pass discovers *how*.
- **Explicit**: Reference specific files, functions, and patterns from the existing codebase. **Never reference line numbers** — they go stale. Reference by function name, class name, or pattern description instead.
- **File-owned**: List every file the task creates or modifies. This lets parallel agents know what they own and what siblings touch.
- **Feature-traced**: Reference which FRs this task covers, so nothing is missed and nothing is invented
- **Verifiable**: Include what shell commands prove the task is done (e.g., `pnpm test`, `pnpm lint`)
- **Repo-scoped**: In multi-repo workspaces, each task targets a single repo (mentioned in title or description)
- **File-conflict-free**: No two parallel tasks modify the same file. Identify shared touchpoint files (routers, protocol types, schema definitions, composition roots) and ensure tasks touching them are serialized via `blockedBy` or combined into a single task
- **Atomically testable**: If you can't test a task independently (e.g., protocol changes without handlers, dispatch without pending maps), it's not a real task — combine it with its dependencies into one task

## Anti-Patterns to Flag

When reviewing the breakdown, watch for and restructure:
- Tasks that only touch one layer (pure DB, pure UI) — prefer vertical slices
- Tasks with vague acceptance criteria ("works correctly")
- Tasks with 10+ steps (too large)
- Circular dependencies
- Tasks that span multiple repos — split into separate single-repo tasks with `blockedBy` for ordering
- Tasks that require context from many previous tasks (context rot risk)
- **Parallel tasks that modify the same file** — tasks that create or modify the same file MUST be serialized via `blockedBy`, never placed in the same parallel wave. If two tasks both need to add to the same file (e.g., both add routes to a router or message types to a protocol), either combine them into one task or serialize them explicitly via `blockedBy`.
- **Tasks that reference patterns created by siblings** — if task B says "follow the pattern in X" and task A creates that pattern, B must `blockedBy` A. Pattern-establishing tasks must be identified and serialized before pattern-consuming tasks.
- **Untestable splits** — protocol changes, dispatch functions, pending maps, and handlers are one atomic unit. If you can't run a test after completing the task alone, it's not a valid split. Combine into one task.

## Eisenhower Matrix for Prioritization

Use importance and urgency to classify tasks:

| | Urgent | Not Urgent |
|---|---|---|
| **Important** | Critical path, blockers | Architecture, quality |
| **Not Important** | Quick wins, polish | Nice-to-haves, defer |

- Mark critical-path tasks and blockers as `important` + `urgent`
- Architecture and quality work is `important` + `not_urgent`
- Quick wins and polish are `not_important` + `urgent`
- Nice-to-haves are `not_important` + `not_urgent` (consider deferring)

## Milestone Plan Document Template

After the task breakdown is approved and created, produce a `m{N}-{slug}.plan.md` document at `{specPath}/milestones/m{N}-{slug}.plan.md` (where `specPath` is resolved from `getProjectDetails`). This is the canonical location where `/engy:implement` and `/engy:implement-milestone` look for plan docs.

```markdown
---
title: {Milestone Name}
status: draft
---

# Plan: M{N} {Milestone Name}

## Overview

{1-2 paragraphs: what this milestone delivers and its boundary. End with an explicit "Boundary: no X, no Y, no Z." sentence listing what is NOT included.}

## Codebase Context

{Key existing files, patterns, and components that this milestone builds on. Reference actual paths and describe what each does — this orients the implementer. Include a note on what previous milestones shipped if relevant.}

## Task Group Sequencing

{Dependency graph between TGs. Which TGs can start immediately, which
depend on others, and what specifically they depend on.}

- **TG1: {Name}** — no dependencies. Can start immediately.
- **TG2: {Name}** — depends on TG1 ({what specifically}).
- ...

## TG1: {Task Group Name}

{One paragraph: what this group delivers and why it's sequenced here.}

### Requirements

1. The system shall {concrete, testable behavior}. *(source: user request | inferred | elicited)* (FR-TG1.1)
2. ...

### Tasks

1. **{Task title}**
   - Files: `path/to/file.ts` [NEW], `path/to/other.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.2
   - {Brief description of what to build}

2. **{Task title}** (depends on task 1)
   - Files: `path/to/another.ts` [NEW]
   - Implements FR-TG1.3
   - {Brief description}

**Parallelizable:** Tasks 1, 3 have no dependencies and can run concurrently.

### Completion Summary

{Updated after TG completes — what was actually shipped, key APIs/patterns
created, anything the next TG's agents need to know. Leave blank until done.}

## TG2: {Task Group Name}

{Repeat structure. Can reference TG1's completion summary for context.}

...

## Out of Scope

- {Feature} (deferred to M{X})
- ...
```

### Template Notes

- **Frontmatter status**: `draft` → `planning` → `complete`
- **No top-level Affected Components or FR sections** — these live under each TG, making each group self-contained for agent dispatch
- **Hierarchical FR numbering**: `FR-TG1.1`, `FR-TG2.1`, etc. — scoped to task group number, deletions in one TG don't affect another
- **Source attribution** on each FR: `(user request)`, `(inferred: reason)`, or `(elicited)` — tracks provenance
- **Codebase Context** prevents the implementer from reimplementing what exists or breaking established patterns
- **Completion Summary** per TG is updated after implementation — gives the next TG's agents context on what shipped without them having to read the code
- **File ownership per task** — every task lists its files so parallel agents know boundaries
- **Never use line numbers** in task descriptions — they go stale. Reference by function/class/pattern name

## Key Principles

- **Never auto-create.** Always present the full breakdown and wait for explicit user approval before calling `createTaskGroup` or `createTask`.
- Ask clarifying questions when scope is ambiguous.
- Keep milestones independent and shippable.
- Set realistic dependencies — avoid over-constraining.
- Plan content should explain the "how" and "why", not just list tasks.

## Flow Position

**Previous:** `write-spec` | **Next:** `plan`

When milestones and tasks are created and approved, proceed with `/engy:plan` to write a detailed implementation plan for the first milestone.
