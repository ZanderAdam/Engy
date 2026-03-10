---
name: engy:implement
description: "Implements tasks, plans, or milestones with TDD, code review, and agent teams. Use when asked to 'implement', 'implement a task', 'implement a plan', 'execute a plan', 'work on task', 'start implementation', or 'implement milestone'."
---

# Implementation Orchestrator

Implement work from any entry point — a single task, a plan document, or an entire milestone. Gathers all relevant context (task details, plan docs, spec, milestone docs) before writing any code.

## MCP Tools

- `getTask(id)` — task details including `milestoneRef`, `specId`, `taskGroupId`, `specPath`
- `listTasks(projectId, milestoneRef, taskGroupId)` — find related tasks
- `updateTask(id, status)` — mark tasks `in_progress` / `done`
- `getProjectDetails(projectId)` — project paths (`specDir`, `projectDir`)
- `listTaskGroups(milestoneRef)` — task groups for a milestone

Use MCP to discover paths and task relationships, then Read/Glob/Grep for content.

## Entry Points

Determine what the user wants to implement:

### A. Single Task

1. `getTask(id)` — read the task's title, description, `milestoneRef`, `specId`, `taskGroupId`.
2. Gather context:
   - If `specPath` exists, read the spec/plan doc at that path.
   - If `milestoneRef` exists, look for a milestone plan doc: `Glob("{docsDir}/**/m{N}-*.plan.md")`.
   - Read any related tasks in the same task group via `listTasks(taskGroupId)` for context on what comes before/after.
3. `updateTask(id, status: "in_progress")`.
4. Proceed to **Implementation**.

### B. Plan Document

1. Read the plan document in full (path or inline content from user).
2. Extract **phases** (requirements + deliverables), **test scenarios** (acceptance criteria), and **dependencies** between phases.
3. Find associated tasks via `listTasks(milestoneRef)` if the plan maps to a milestone.
4. Proceed to **Implementation** using plan phases.

### C. Milestone

1. `listTaskGroups(milestoneRef)` + `listTasks(milestoneRef)` — get the full task breakdown.
2. Look for the milestone plan doc: `Glob("{docsDir}/**/m{N}-*.plan.md")`. Read it if found.
3. Read the spec for overall context.
4. Work through tasks in dependency order (respect `blockedBy`). For each task, follow the **Single Task** flow.

## Implementation

### Phase 0: Discover Validation Gates

Scan project config to find **all explicit validation the project asks for**. Check these sources in order:

1. **CLAUDE.md** — look for explicit validation and testing instructions. These are the highest priority.

### Phase 0b: Create Session Tasks

Create task pairs using Claude's built-in `TaskCreate` tool (session-level tracking):

- **Phase N#a** (implement) — includes requirements, test scenarios, and the **tests-only** command for fast feedback
- **Phase N#b** (validate/fix/commit) — includes the **full validation** command and any mandatory skill invocations

Chain dependencies with `TaskUpdate` (addBlockedBy): N#a → N#b → (N+1)#a.

Add a **Final Validation** task after all phases that includes any manual checks (Chrome testing, etc.) discovered from project config.

### Phase N#a: Implement via TDD

1. Mark task `in_progress`
2. Identify **independent domains** — sub-tasks touching non-overlapping file sets with no shared state. If single domain, implement inline.
3. For 2+ independent sub-tasks, use agent teams. See `references/agent-team-coordination.md` for parallelization criteria, agent context requirements, and conflict prevention.
4. TDD is mandatory. **Test strategy cascade:** plan document > project config > codebase conventions. Test scenarios come from the plan or are derived from requirements — never invented without basis.
5. **Orchestrator owns the full build command.** Teammates run only their area tests.

### Phase N#b: Validate, Fix & Commit

1. Rim `/engy:review`
2. Run the **full validation command** discovered in Phase 0, read complete output, verify explicitly — never assume success
3. Triage feedback by severity (Critical → High → Medium). Address all Critical and High items, re-run validation. If significant rework needed, return to #a.
4. **Circuit breaker:** after 3 failed validation/review cycles, stop and report to user with diagnostics
5. On success: commit the phase, mark both #a and #b tasks completed, update Engy task status via `updateTask(id, status: "done")` if working from an Engy task

### Final Validation

After all phase pairs complete, run end-to-end validation appropriate for the project

## Key Principles

- **Context before code.** Always gather task details, plan docs, spec, and milestone docs before writing any code.
- **Evidence before claims.** Run build, read full output, verify explicitly.
- **Fresh context per agent.** Each teammate gets a complete, self-contained sub-task description. Never assume shared context.
- **Phase-level commits.** One commit per phase, each in a working state.

## Additional Resources

### Reference Files

- **`references/agent-team-coordination.md`** - Parallelization criteria, agent context requirements, and conflict prevention guidelines

## Flow Position

**Previous:** `validate-plan` | **Next:** `review`

When all implementation phases are complete and passing, proceed with `/engy:review` for a final code review of all changes.
