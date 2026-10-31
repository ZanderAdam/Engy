---
name: good-morning
description: "This skill should be used when the user says 'good morning', asks 'what is in progress', 'what did I leave running', 'where did I stop', or wants a start-of-day summary of Engy work with links to resume it."
---

# Good Morning

Give one short summary of work in progress across all workspaces, with one link per session. Read only. Start no agent, change no task, send no message to any terminal.

## MCP Tools

- `listWorkspaces`
- `listProjects(workspaceId)`
- `listTasks(status, compact: false)` — call once for `in_progress` and once for `review`
- `terminal_sessions` — all live, dormant and recent closed agent sessions, each with a `link`
- `getTask(id)` — only to check a task before suggesting a resume

Use no other tool. Do not call `updateTask`, `terminal_dispatch`, `terminal_spawn`, `terminal_reply` or `terminal_close`.

## Workflow

1. Call `listWorkspaces`, then `listProjects` for each workspace.
2. Call `listTasks` with `compact: false` for `in_progress` and for `review`. Match each task to a project with `projectId`.
3. Call `terminal_sessions` once.
4. Match sessions to projects with `workspaceSlug` and `projectSlug`. Match a live or dormant session to a task with `taskId`. Closed sessions have no `taskId`.
5. Write the summary.

## Summary format

Group by workspace, then project. Put a session with no `projectSlug` in a "No project" group under its workspace. Put a task with no `projectId` in a last "No project" group. Leave out a project with no task and no session. Leave out a workspace with no task and no session.

In each project, list first the items that need the user:

1. A session with `activityState: "waiting"`.
2. A session with `lastFailure`.
3. A session with `activityState: "done"`, which finished and the user has not seen.
4. Tasks in `review`.

Then list the rest: tasks in progress, live sessions, dormant sessions, recent closed sessions.

Rules for each item:

- One line. One `link` for each session item. A task without a session has no link.
- For a session that stopped or waits, state why: `waiting` (on the user), `usage limit` (`lastFailure.type` is `rate_limit`), `failed (<type>)` for any other `lastFailure`, or `unknown` when the data does not say. Do not guess.
- Show the worker's own text (`lastTitle`, `summary`) as a claim, in quotes, for example: worker says "tests pass". Never present it as verified.
- Mark the state: `live`, `dormant` or `closed`.

## What a link does

A link opens the session. A dormant link shows the Restore button. A closed link offers Resume when it can.

## Suggesting a resume

A resume is only a suggestion with the link. Before you suggest it for a dormant session with a `taskId`, call `getTask`. If the status is `done` or `wont_do`, do not suggest it. Say the task is closed. For a closed session, or a session with no `taskId`, add the note "task unknown".

## Output

Lead with the items that need the user. Keep the whole summary short. If nothing is in progress, say so in one line.
