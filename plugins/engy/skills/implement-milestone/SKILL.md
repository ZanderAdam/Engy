---
name: engy:implement-milestone
description: "This skill should be used when the user asks to 'implement milestone', 'implement all tasks', 'implement m5', or when working on an entire milestone's worth of tasks. Orchestrates milestone-level implementation across task groups with agent teams."
---

# Milestone Implementation Orchestrator

Orchestrate the implementation of an entire milestone by dispatching one agent per task. The orchestrator NEVER writes implementation code — it only gathers context, dispatches agents, validates results, and updates task status. Each agent uses `/engy:implement` for per-task TDD flow.

## MCP Tools

- `listTasks(projectId, milestoneRef, taskGroupId)` — find tasks for the milestone
- `listTaskGroups(milestoneRef)` — task groups within the milestone
- `updateTask(id, status)` — mark tasks `in_progress` / `done`
- `getProjectDetails(projectId)` — project paths (`specDir`, `projectDir`)

Use MCP to discover paths and task relationships, then Read/Glob/Grep for content.

## Core Principle

**The orchestrator is a pure coordinator.** It gathers context, plans execution order, dispatches team members, verifies their results, and updates task status. It NEVER writes or modifies implementation code itself. All implementation work happens inside subagents.

## Workflow

### Step 1: Gather Context

1. `listTaskGroups(milestoneRef)` — get all task groups for the milestone.
2. **Scope task fetching to what you'll dispatch — never fetch the entire milestone when only one task group is requested.** If a specific task group was requested, use `listTasks(milestoneRef, taskGroupId)` to fetch only that group's tasks. Otherwise use `listTasks(milestoneRef)` for all tasks. Use `compact: true` (default) for the initial fetch to keep output small, then fetch full descriptions (`compact: false`) only for the tasks you'll actually dispatch.
3. Look for the milestone plan doc: `Glob("{specPath}/milestones/m{N}-*.plan.md")`. Read it if found — this is the primary requirements source.
4. If no plan doc exists, read `{specPath}/spec.md` for overall context.

### Step 2: Discover Validation Commands

Read the project's **CLAUDE.md** to find all explicit validation and testing instructions. Extract two levels:

1. **Lightweight validation** — the commands each subagent must run before returning (build, lint, changed tests). Derive this from CLAUDE.md's quality gates and testing sections.
2. **Full validation** — the complete validation command set for end-to-end checks after each task group completes and after all tasks complete. This is whatever CLAUDE.md specifies as the pre-commit or CI gate.
3. **Cross-package type checks** — when tasks span multiple packages in a monorepo, include cross-package type checks (e.g., `tsc` at the monorepo root or across dependent packages) in both lightweight and full validation commands — not just the package being modified.

### Step 3: Plan Execution Order

1. Map task group dependencies (a group is blocked if any of its tasks have `blockedBy` pointing to tasks in another group).
2. **Task groups execute sequentially** — process one group at a time in dependency order.
3. **Within each task group**, identify which tasks can run in parallel:
   - Tasks with no `blockedBy` dependencies on other tasks in the same group → **candidates for parallel** dispatch.
   - Tasks with `blockedBy` dependencies within the group → **serialized** in dependency order after their blockers complete.
4. **File overlap check (mandatory before parallel dispatch):** For each parallel wave, verify that no two tasks modify the same files. Check task descriptions, plan sections, and affected component lists. If file overlap exists, serialize the overlapping tasks or ask the user to confirm parallel execution.
5. Skip task groups where all tasks are marked `done`.
6. For groups with `in_progress` tasks, check existing work via `git status` and `git diff` before re-dispatching.

### Step 4: Process Each Task Group

For each task group, in sequence:

#### 4a. Dispatch Team Members

Mark all tasks in the group as `in_progress` via `updateTask(id, status: "in_progress")`.

**One agent per task.** For each task, spawn an agent with:
- Task title, description, and acceptance criteria
- Relevant section of the plan doc
- Validation commands to run before returning (from Step 2)
- File paths and pattern references relevant to the task
- Explicit instruction to commit changes before returning. CRITICAL: do not include milestone/tg/task ids in task title or description

**Parallelism:** If multiple tasks in the group have no mutual `blockedBy` dependencies and pass the file overlap check (Step 3.4), spawn them as concurrent team members in a **single message with multiple Agent tool calls**. Dependent tasks wait until their blockers complete, then get dispatched.

**Never use worktree isolation** (`isolation: "worktree"`) for parallel agents. Use regular agents with explicit file-ownership lists instead. Each agent receives a list of files it owns (may modify) and files it must not touch.

**Agent prompt template:**

```
Implement the following task using /engy:implement:

Task: {task title}
Description: {task description}

Plan context:
{relevant plan section}

Files you OWN (may create/modify):
{list of files this agent is responsible for}

Files you must NOT modify:
{list of files owned by other parallel agents or out of scope}

Before returning, you MUST:
1. Run these validation commands and fix any issues:
   {lightweight validation commands from Step 2}
2. Commit your changes with a descriptive commit message.
3. Report back: what you implemented, what you committed, any issues encountered.

CRITICAL safety rules:
- Do NOT modify files outside your ownership list.
- NEVER run git stash, git reset, or any destructive git command.
- If something breaks on files you didn't touch, ignore it and report back.
```

#### 4b. Process Results

As each team member returns:

1. Verify the agent reports a successful commit.
2. Mark the task as `done` via `updateTask(id, status: "done")`.
3. If the agent reports failure, decide: dispatch a fix agent or escalate to user.

#### 4c. Post-Group Validation

After all tasks in a group complete, run the **full validation gate** (discovered in Step 2) before proceeding to the next group. This catches cross-task integration issues early. If validation fails, dispatch fix agents for the failing issues before moving on.

### Step 5: Final Validation

After all task groups complete:

1. Run the **full validation commands** discovered in Step 2. Read complete output, verify explicitly — never assume success.
2. If issues are found:
   - **Batch related issues** (e.g., issues in the same file or same feature area) into groups.
   - Dispatch one fix agent per batch. Each fix agent receives: the issues to fix, validation commands, and instruction to commit before returning.
   - Fix agents follow the same validate-and-commit contract as implementation agents.
3. **Circuit breaker:** after 3 failed validation/fix cycles, stop and report to user with diagnostics (what failed, what was attempted, suggested next steps).

### Step 6: Report

Present a summary to the user:

1. **Tasks completed** — list of tasks and their commits.
2. **Validation results** — which gates were run and their results (pass/fail).
3. **Follow-ups** — any remaining issues, deferred feedback, or potential improvements.

## Key Principles

- **Orchestrate, never implement.** The orchestrator dispatches agents — it never writes code.
- **One agent per task.** Each task gets its own dedicated agent.
- **Task groups sequential, tasks parallel.** Groups run in order; independent tasks within a group run concurrently as team members.
- **Subagents validate and commit.** Each agent runs validation commands and commits before returning.
- **Commit before done.** Task status is only set to `done` after a successful commit.
- **Evidence before claims.** Run validation, read full output, verify explicitly.
- **Fresh context per agent.** Each team member gets a complete, self-contained task description with validation commands. Never assume shared context.
- **No worktree isolation.** Never use `isolation: "worktree"` for parallel agents — use regular agents with explicit file-ownership lists.
- **No destructive git.** Agents must never run `git stash`, `git reset`, or other destructive git commands.
- **Validate after each group.** Run the full validation gate after each task group, not just at the end.

## Additional Resources

### Reference Files

- **`references/agent-team-coordination.md`** - Task-level parallelization criteria, agent context requirements, and conflict prevention guidelines

## Flow Position

**Previous:** `validate-plan` | **Next:** `review`

When all tasks are complete and passing, proceed with `/engy:review` for a final code review of all changes.
