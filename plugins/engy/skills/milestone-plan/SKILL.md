---
name: engy:milestone-plan
description: "Plans spec milestones in detail — task groups, tasks, dependencies, and priorities. Use when asked to 'plan my project', 'plan milestones', 'break down into tasks', or 'create tasks for milestone'."
---

# Milestone Planner

The spec already contains a high-level list of milestones. This skill plans **one milestone at a time** in detail — defining task groups, individual tasks, dependencies, and priorities. Everything is presented to the user for approval before creating anything in the system.

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specDir`, `projectDir`) + workspace context
- `createTask`, `updateTask`, `listTasks`, `getTask` — task CRUD (responses include `specPath`)
- `createTaskGroup`, `listTaskGroups` — group tasks within milestones

Use MCP to discover paths, then Read/Glob/Grep for spec content.

## Planning Levels

### Level 1: Identify Which Milestone to Plan

1. Get the project's `specDir` via `getProjectDetails`.
2. Read `{specDir}/spec.md` and extract the existing milestone list.
3. **Determine which milestone to plan:**
   - If the user specified a milestone, use that one.
   - Otherwise, check for existing milestone plan docs (e.g., `{specDir}/../projects/*/m*-plan.md` or task groups via `listTaskGroups`). Find the **next unplanned milestone** in sequence.
4. Present the selected milestone and its scope to the user for confirmation before proceeding.

**Do NOT create task groups or tasks yet.** Level 1 is purely about selecting and confirming which milestone to plan.

**One milestone per run.** Do not plan multiple milestones unless the user explicitly asks.

### Level 2: Plan Milestone Details (Groups and Tasks)

For the selected milestone:

1. Review the milestone scope against the spec.
2. Break the milestone into **task groups**. Each group is a single deliverable — think one PR. Groups are ordered so they can be reviewed and merged as stacked PRs, making large milestones easier to review incrementally.
3. Within each group, define 1 or more tasks that together produce that deliverable. Follow the vertical slicing and granularity guidelines below.
4. For each task, specify:
   - Title and description
   - Type (`ai` or `human`)
   - Importance and urgency (using the Eisenhower matrix)
   - Dependencies on other tasks (`blockedBy`)
5. **Present the full breakdown to the user and wait for explicit approval.**
6. Only after approval: create groups and tasks via `createTaskGroup` / `createTask`.
   - Set `milestoneRef` on every task (e.g., `"m3"`) to link it to the milestone.
   - Set `specId` to the spec directory name so the task resolves to the correct spec path.
   - If the task descriptions and/or the spec+plan doc are detailed enough for an agent to implement without a separate planning step, set `needsPlan: false` on those tasks.
7. Verify structure via `listTasks` and `listTaskGroups`.
8. Write the milestone plan document (`m{N}-{slug}.plan.md`) using the template below.

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
- **Session-independent**: An agent starting fresh with only the codebase and task description should be able to complete it
- **Explicit**: Reference specific files, functions, and patterns from the existing codebase
- **Verifiable**: Include what shell commands prove the task is done (e.g., `pnpm test`, `pnpm lint`)
- **Clear on done state**: Describe what the codebase looks like when the task is complete

## Anti-Patterns to Flag

When reviewing the breakdown, watch for and restructure:
- Tasks that only touch one layer (pure DB, pure UI) — prefer vertical slices
- Tasks with vague acceptance criteria ("works correctly")
- Tasks with 10+ steps (too large)
- Circular dependencies
- Tasks that require context from many previous tasks (context rot risk)

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

After the task breakdown is approved and created, produce a `m{N}-{slug}.plan.md` document in the project's docs directory following this structure:

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

## Affected Components

| File | Change |
|------|--------|
| `path/to/file.ts` | **Create** — description |
| `path/to/existing.ts` | **Modify** — description |

## Functional Requirements

### {Feature Area 1}

1. The system shall {concrete, testable behavior}. *(source: user request | inferred | elicited)*
2. ...

### {Feature Area 2}

3. ...

## Out of Scope

- {Feature} (deferred to M{X})
- ...
```

### Template Notes

- **Frontmatter status**: `draft` → `planning` → `complete`
- **Affected Components**: list every new and modified file — this is the implementer's checklist
- **FRs are numbered continuously** across feature areas (not restarting per section)
- **Source attribution** on each FR: `(user request)`, `(inferred: reason)`, or `(elicited)` — tracks provenance
- **Codebase Context** prevents the implementer from reimplementing what exists or breaking established patterns

## Key Principles

- **Never auto-create.** Always present the full breakdown and wait for explicit user approval before calling `createTaskGroup` or `createTask`.
- Ask clarifying questions when scope is ambiguous.
- Keep milestones independent and shippable.
- Set realistic dependencies — avoid over-constraining.
- Plan content should explain the "how" and "why", not just list tasks.

## Flow Position

**Previous:** `spec-author` | **Next:** `planner`

When milestones and tasks are created and approved, proceed with `/engy:planner` to write a detailed implementation plan for the first milestone.
