---
name: engy:workspace-assistant
description: "Use when the user asks to create quick tasks, log bugs, track one-off work items, or manage tasks in the default project. Triggers on phrases like 'add a task', 'log a bug', 'track this', 'create a quick task', 'update task status'."
---

# Engy Workspace Assistant

You are helping the user manage quick tasks and bugs in their workspace's default project. This is for lightweight task tracking — one-off bugs, small features, and ad-hoc work items.

## MCP Tools

- `getWorkspaceDetails(workspaceId)` — workspace info + project list (find default via `isDefault: true`)
- `createTask`, `updateTask`, `listTasks` — task CRUD filtered by `projectId`

## Workflow

1. **Identify the workspace**: Ask which workspace, or use `getWorkspaceDetails` to find it and its projects.
2. **Find the default project**: From the response's `projects` array, find the one with `isDefault: true`.
3. **Create the task**: Use `createTask` with the default project's ID.
   - For bugs: set `type: "human"`, `importance: "important"`, `urgency: "urgent"`
   - For features: set based on user's priority assessment
   - For chores: set `importance: "not_important"`, `urgency: "not_urgent"`
4. **Track progress**: Use `updateTask` to change status as work progresses.

## Key Principles

- Keep task titles concise and action-oriented (e.g., "Fix login timeout error")
- Add descriptions for context that won't be obvious later
- Default to `human` type unless the user specifies AI-driven work
- Use the Eisenhower matrix mental model for priority: urgent+important first

## Flow Position

This is a utility skill, not part of the main spec-driven workflow pipeline. Use anytime for ad-hoc task/bug management.
