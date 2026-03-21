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
   - Otherwise, check for existing milestone plan docs via `Glob("{specPath}/m*-*.plan.md")` or task groups via `listTaskGroups`. Find the **next unplanned milestone** in sequence.
4. Present the selected milestone and its scope to the user for confirmation before proceeding.

**Do NOT create task groups or tasks yet.** Level 1 is purely about selecting and confirming which milestone to plan.

**One milestone per run.** Do not plan multiple milestones unless the user explicitly asks.

### Level 2: Plan Milestone Details (Groups and Tasks)

For the selected milestone:

0. **Confirm the correct projectId.** Use `listProjects` to find the project whose `specDir` matches the spec you're working with. Do NOT assume projectId=1.
1. **Discover workspace repos.** Call `getProjectDetails(projectId)` and check `workspace.repos`. If the workspace has multiple repos, apply the multi-repo task scoping rules (see above) throughout the remaining steps.
2. Review the milestone scope against the spec.
3. Break the milestone into **task groups**. Each group is a single deliverable — think one PR. Groups are ordered so they can be reviewed and merged as stacked PRs, making large milestones easier to review incrementally. For multi-repo workspaces, set the `repos` field on each group to the repos its tasks touch.
4. Within each group, define 1 or more tasks that together produce that deliverable. Follow the vertical slicing and granularity guidelines below. **Each task must target a single repo** — include the target repo/package in the task title or description (e.g., "Implement auth middleware in `web/`"). For cross-repo dependencies, use `blockedBy` to order upstream tasks before downstream consumers.
5. For each task, specify:
   - Title and description (including target repo for multi-repo workspaces)
   - **Acceptance criteria in Gherkin format** (`Given/When/Then`) — derived from the plan's test scenarios or functional requirements. These are what the implementer tests against.
   - **Feature references** — which FRs or plan scenarios this task implements (e.g., "Implements FR #5, #6" or "Covers Scenario: Get file diff")
   - Type (`ai` or `human`)
   - Importance and urgency (using the Eisenhower matrix)
   - Dependencies on other tasks (`blockedBy`)
6. **Present the full breakdown to the user and wait for explicit approval.**
7. Only after approval: create groups and tasks via `createTaskGroup` / `createTask`.
   - Set `milestoneRef` on every task (e.g., `"m3"`) to link it to the milestone.
   - Set `specId` to the spec directory name so the task resolves to the correct spec path.
   - For multi-repo workspaces, pass the `repos` array when calling `createTaskGroup`.
   - If the task descriptions and/or the spec+plan doc are detailed enough for an agent to implement without a separate planning step, set `needsPlan: false` on those tasks.
8. Verify structure via `listTasks` and `listTaskGroups`.
9. Write the milestone plan document (`m{N}-{slug}.plan.md`) using the template below.

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
- **Acceptance-tested**: Include Gherkin scenarios (Given/When/Then) that define done. These come from the plan doc's test scenarios or are derived from the FRs the task implements.
- **Feature-traced**: Reference which FRs or plan scenarios this task covers, so nothing is missed and nothing is invented
- **Verifiable**: Include what shell commands prove the task is done (e.g., `pnpm test`, `pnpm lint`)
- **Repo-scoped**: In multi-repo workspaces, each task targets a single repo (mentioned in title or description)
- **File-conflict-free**: No two parallel tasks modify the same file. Identify shared touchpoint files (routers, protocol types, schema definitions, composition roots) and ensure tasks touching them are serialized via `blockedBy` or combined into a single task

## Anti-Patterns to Flag

When reviewing the breakdown, watch for and restructure:
- Tasks that only touch one layer (pure DB, pure UI) — prefer vertical slices
- Tasks with vague acceptance criteria ("works correctly")
- Tasks with 10+ steps (too large)
- Circular dependencies
- Tasks that span multiple repos — split into separate single-repo tasks with `blockedBy` for ordering
- Tasks that require context from many previous tasks (context rot risk)
- **Parallel tasks that modify the same file** — tasks that create or modify the same file MUST be serialized via `blockedBy`, never placed in the same parallel wave. If two tasks both need to add to the same file (e.g., both add routes to a router or message types to a protocol), either combine them into one task or serialize them explicitly via `blockedBy`.

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

After the task breakdown is approved and created, produce a `m{N}-{slug}.plan.md` document at `{specPath}/m{N}-{slug}.plan.md` (where `specPath` is resolved from `getProjectDetails`). This is the canonical location where `/engy:implement` and `/engy:implement-milestone` look for plan docs.

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

**Previous:** `write-spec` | **Next:** `plan`

When milestones and tasks are created and approved, proceed with `/engy:plan` to write a detailed implementation plan for the first milestone.
