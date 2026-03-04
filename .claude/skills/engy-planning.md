---
name: engy-planning
description: Use when the user asks for guided progressive planning, multi-level project decomposition, or structured planning loops. Triggers on phrases like "plan my project", "progressive planning", "help me plan milestones", "planning loop", "decompose into milestones and tasks".
---

# Engy Progressive Planning

You guide the user through a structured, multi-level planning process for their Engy project. Planning proceeds top-down: project -> milestones -> task groups -> tasks -> plan content.

## Available MCP Tools

- `getSpec` / `readSpecFile` — Read spec metadata and content
- `getProjectOverview` — Project details with progress
- `listProjectTasks` — All tasks with milestone/group hierarchy
- `createMilestone` — Create a milestone (title, scope, sortOrder)
- `createTaskGroup` — Create a task group under a milestone
- `createTask` — Create a task with full metadata
- `planMilestone` — Upsert plan content and optionally transition status
- `updateTask` — Update task fields
- `listProjects` — List projects in a workspace

## Planning Levels

### Level 1: Project Planning (Milestones from Spec)

1. Read the project's spec using `getSpec` and `readSpecFile`.
2. Identify 3-7 shippable milestones from the requirements.
3. For each milestone, define: title, scope (1-2 sentences), sort order.
4. Present the milestone list to the user for approval.
5. Create approved milestones using `createMilestone`.

### Level 2: Milestone Planning (Groups and Tasks)

For each milestone:

1. Review the milestone scope.
2. Identify logical task groups (e.g., "server", "ui", "testing", "docs").
3. Within each group, define individual tasks with:
   - Title, description, type (ai/human)
   - Importance and urgency (Eisenhower matrix)
   - Dependencies on other tasks
4. Present the breakdown to the user for approval.
5. Create groups with `createTaskGroup`, then tasks with `createTask`.

### Level 3: Plan Content Authoring

For each milestone:

1. Write a plan document describing the implementation approach.
2. Include: goals, key decisions, risks, implementation steps.
3. Save using `planMilestone` with `transitionToPlanning: true`.

## Guidelines

- Always present each level to the user before creating anything
- Ask clarifying questions when scope is ambiguous
- Keep milestones independent and shippable
- Keep tasks small (1-4 hours of work)
- Set realistic dependencies — avoid over-constraining
- Use the Eisenhower matrix for prioritization:
  - Urgent + Important: critical path, blockers
  - Not Urgent + Important: architecture, quality
  - Urgent + Not Important: quick wins, polish
  - Not Urgent + Not Important: nice-to-haves, defer
