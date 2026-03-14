---
name: engy:implement
description: "This skill should be used when the user asks to 'implement', 'implement a task', 'implement a plan', 'execute a plan', 'work on task', or 'start implementation'."
---

# Task Implementation

Implements a single task or plan document end-to-end: context gathering, TDD implementation, code review, and validation. For milestone-level orchestration across multiple task groups, use `/engy:implement-milestone`.

## MCP Tools

- `getTask(id)` — task details including title, description, status
- `updateTask(id, status)` — mark tasks `in_progress` / `review` / `done`
- `getProjectDetails(projectId)` — project paths

## Step 1: Gather Context

### A. From an Engy Task

1. `getTask(id)` — read the task's title, description, and status.
2. **Check for existing work** — If task status is `in_progress`:
   - Run `git status` and `git diff` to identify uncommitted changes related to this task.
   - Review changed files to understand what's already done vs. what remains.
   - Adjust implementation scope to only cover remaining work.
3. If the task description references a plan document path, read that plan — it is the primary requirements source. Otherwise the task description itself is the requirements source.
4. `updateTask(id, status: "in_progress")`.

### B. From a Plan Document

1. Read the plan document in full (path or inline content from user).
2. Extract **phases** (requirements + deliverables), **test scenarios** (acceptance criteria), and **dependencies** between phases.
3. The plan document is the primary requirements source.

## Step 2: Discover Validation Gates

Read the project's **CLAUDE.md** for explicit validation and testing instructions.

## Step 3: Create Session Tasks

CRITICAL: Before writing any code, create internal session tasks (`TaskCreate`) for **every step** of the implementation. This ensures progress is tracked and nothing is missed.

Create one task per small, independent unit of work. Keep tasks focused — each should be completable on its own.

1. **Implementation tasks** — one per logical unit (e.g., "Add X migration", "Implement Y service", "Write tests for Z").
2. **Final validation task** — always the last task. See Step 5.

Chain dependencies with `TaskUpdate` (`addBlockedBy`) so tasks execute in order.

**Example:**
- Task #1: "Add user preferences table migration"
- Task #2: "Implement preferences service" (blocked by #1)
- Task #3: "Add API endpoint for preferences" (blocked by #2)
- Task #4: "Run /engy:review, pnpm blt, test in Chrome" (blocked by #3) — CRITICAL, always required

## Step 4: Implement via TDD (Red-Green-Refactor)

For each implementation task, follow the TDD cycle strictly:

1. Mark the session task `in_progress`.
2. **Red** — Write a failing test first. Test scenarios come from the requirements source (task description or plan) — never invented without basis. **Test strategy cascade:** requirements source > project config > codebase conventions.
3. **Green** — Write the minimum code to make the test pass.
4. **Refactor** — Clean up the implementation while keeping tests green. Remove duplication, improve naming, simplify.
5. Repeat the red-green-refactor cycle until the task's requirements are fully covered.
6. Run the task's area tests to confirm everything passes. Mark session task completed.

## Step 5: Final Validation

CRITICAL: This step is **always required** as the last session task. It follows whatever the project's CLAUDE.md specifies for quality gates.

After all implementation tasks are done:

1. Run `/engy:review`.
2. Run the **full validation command** discovered in Step 2. Read complete output, verify explicitly — never assume success.
3. Triage feedback by severity (Critical → High → Medium). Address all Critical and High items, re-run validation.
4. **Circuit breaker:** after 3 failed validation/review cycles, stop and report to user with diagnostics.
5. Run any manual checks specified in project config (e.g., test in Chrome).
6. On success: commit the changes, mark all session tasks completed.

## Engy Task Status Flow

When working from an Engy task, update its status via `updateTask(id, status)`:

1. **`in_progress`** — set when starting work (Step 1).
2. **`review`** — set if the task needs human input before it can be marked done.
3. **`done`** — set once changes are committed.

## Step 6: Final Output

After all work is complete, present a summary to the user:

1. **Changes made** — brief summary of what was implemented.
2. **Validation gates** — which gates were run and their results (pass/fail).
3. **Follow-ups** — any remaining issues, deferred feedback, or potential improvements.

## Key Principles

- **Context before code.** Always gather task details before writing any code.
- **Evidence before claims.** Run build, read full output, verify explicitly.
- **Task tracking.** Create session tasks for every step — nothing happens untracked.

