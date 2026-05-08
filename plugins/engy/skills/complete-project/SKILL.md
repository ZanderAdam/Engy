---
name: engy:complete-project
description: Orchestrate project completion. Triggers distillation of unpromoted fleetings, hands off to /engy:review-memories, then /engy:propose-sysdocs, then archives the project.
---

# Project Completion Orchestrator

Guides a project through its full completion lifecycle: distillation, memory review, system doc proposals, and archival. Each phase pauses for user confirmation so nothing is irreversible without explicit approval.

## MCP Tools

- `getProjectDetails(projectId)` — resolve the project and its workspace
- `listProjects(workspaceId)` — find the active project if not provided

## tRPC Mutations

Two mutations are called via the tRPC client during this flow:

- `project.startCompletion({ projectId })` — marks project status as `completing` and returns the list of candidate fleeting memories for distillation review. Call this to begin the flow.
- `project.archive({ projectId })` — marks project status as `archived`. Call this only after user confirms all review phases are complete.

## Phase 1: Resolve Project

1. Identify the current project from session context (active project name/slug or the user's explicit mention).
2. Call `getProjectDetails(projectId)` to confirm the project exists and retrieve its workspace slug.
3. Print the project name and status to the user so they know what will be completed.

## Phase 2: Distillation

1. Call the `project.startCompletion({ projectId })` tRPC mutation.
   - This sets the project status to `completing`.
   - It returns the candidate list of unpromoted fleeting memories scoped to the workspace.
2. Print the count of candidate fleetings (e.g., "Found 12 candidate memories for review").
3. **Pause.** Present the candidates briefly and ask the user: "Ready to proceed to memory review? This will hand off to `/engy:review-memories`."
4. Wait for explicit user confirmation before continuing.

## Phase 3: Memory Review

After user confirms:

1. Hand off to `/engy:review-memories` as a separate skill invocation.
   - The user works through each candidate: approve, edit, supersede, contradict, or skip.
   - This phase is interactive and may take time — do not rush or batch-skip candidates.
2. When the user signals review-memories is complete, return to this orchestration flow.

## Phase 4: System Doc Proposals

1. Hand off to `/engy:propose-sysdocs` as a separate skill invocation.
   - The skill reads completed tasks and promoted memories to propose updates to `{workspaceDir}/system/` files.
   - Changes are uncommitted working-tree writes — the user reviews them in the diff viewer.
2. When the user signals propose-sysdocs is complete (or declines), return to this orchestration flow.

## Phase 5: Archive

1. **Pause.** Confirm with the user: "Memory review and doc proposals are complete. Archive the project now? This will mark it archived and preserve all tasks, plan content, and promoted memories."
2. On confirmation, call the `project.archive({ projectId })` tRPC mutation.
3. Print confirmation: "Project archived. Agent sessions and execution logs have been removed. Plan, tasks, and memories are preserved."

## Key Principles

- **Pause between phases.** Never run phases back-to-back without user confirmation. Each pause is a checkpoint where the user can stop, inspect, or continue later.
- **Phases are resumable.** If the user stops mid-flow, they can re-invoke `/engy:complete-project` and pick up from where they left off by checking the project's current status via `getProjectDetails`.
- **Archival is final.** Make sure the user understands archival removes agent sessions and execution logs before calling `project.archive`.

## Flow Position

**Previous:** Active project with tasks in `done` status | **Next:** Knowledge available via workspace-level memory for future projects
