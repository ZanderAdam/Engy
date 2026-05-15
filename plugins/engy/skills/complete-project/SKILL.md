---
name: engy:complete-project
description: Orchestrate project completion. Triggers distillation of unpromoted fleetings, hands off to /engy:review-memories, then /engy:propose-sysdocs, then archives the project.
---

# Project Completion Orchestrator

Guides a project through its full completion lifecycle: distillation, memory review, system doc proposals, and archival. Each phase pauses for user confirmation so nothing is irreversible without explicit approval.

## MCP Tools

- `getProjectDetails({ projectId })` — fetch project metadata, status, and workspace context.
- `listProjects({ workspaceId })` — find the active project if not provided.
- `startProjectCompletion({ projectId })` — set status to `completing` and return ranked candidate fleeting memories for distillation review.
- `archiveProject({ projectId })` — mark project as `archived` and remove agent sessions. Plan, tasks, and promoted memories are preserved.

## Phase 1: Resolve Project

1. Identify the current project from session context (active project name/slug or the user's explicit mention).
2. Call `getProjectDetails({ projectId })` to confirm the project exists and retrieve its workspace slug and status.
3. **Branch on status:**
   - If `status` is `archived`: print "Project is already archived; nothing to do." and stop.
   - If `status` is `completing`: ask the user "Project is mid-completion. Resume from Phase 3 (review memories) or restart from Phase 2 (distillation)?" and proceed based on their answer.
   - Otherwise: print the project name and current status, then continue to Phase 2.

## Phase 2: Distillation

1. Call `startProjectCompletion({ projectId })`.
   - This sets the project status to `completing`.
   - It returns `{ candidates: FleetingMemory[] }` — unpromoted fleeting memories scoped to the workspace, ranked by signal score.
2. Print the count of candidate fleetings (e.g., "Found 12 candidate memories for review").
3. **Pause.** Present the candidates briefly and ask the user: "Ready to proceed to memory review? This will hand off to `/engy:review-memories`."
4. Wait for explicit user confirmation before continuing.

## Phase 3: Memory Review

After user confirms:

1. Tell the user: "Now run `/engy:review-memories`. Wait for the user to confirm it's complete before proceeding."
   - The user works through each candidate: approve, edit, supersede, contradict, or skip.
   - This phase is interactive and may take time — do not rush or batch-skip candidates.
2. When the user signals review-memories is complete, return to this orchestration flow.

## Phase 4: System Doc Proposals

1. Tell the user: "Now run `/engy:propose-sysdocs`. Wait for the user to confirm it's complete before proceeding."
   - The skill reads completed tasks and promoted memories to propose updates to `{workspaceDir}/system/` files.
   - Changes are uncommitted working-tree writes — the user reviews them in the diff viewer.
2. When the user signals propose-sysdocs is complete (or declines), return to this orchestration flow.

## Phase 5: Archive

1. **Pause.** Confirm with the user: "Memory review and doc proposals are complete. Archive the project now? This will mark it archived and preserve all tasks, plan content, and promoted memories."
2. On confirmation, call `archiveProject({ projectId })`.
3. Print confirmation: "Project archived. Agent sessions and execution logs have been removed. Plan, tasks, and memories are preserved."

## Key Principles

- **Pause between phases.** Never run phases back-to-back without user confirmation. Each pause is a checkpoint where the user can stop, inspect, or continue later.
- **Phases are resumable.** If the user stops mid-flow, they can re-invoke `/engy:complete-project` and pick up from where they left off by checking the project's current status via `getProjectDetails`.
- **Archival is final.** Make sure the user understands archival removes agent sessions and execution logs before calling `archiveProject`.

## Flow Position

**Previous:** Active project with tasks in `done` status | **Next:** Knowledge available via workspace-level memory for future projects
