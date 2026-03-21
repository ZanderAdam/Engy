# Agent Team Coordination

## Dispatch Model

One agent per task. The orchestrator spawns agents — it never implements.

## When to Parallelize

Within a task group, parallelize tasks that have **no mutual `blockedBy` dependencies**. Spawn parallel tasks as concurrent team members in a single message (multiple Agent tool calls).

Serialize when:
- Task B has `blockedBy` pointing to Task A in the same group.
- Tasks modify overlapping file sets — **mandatory check before every parallel dispatch**. Cross-reference task descriptions, plan sections, and affected component lists to build each task's file set.
- Tasks share mutable state (e.g., DB migrations that must run in order).

When in doubt, serialize — merge conflicts cost more than time saved.

**Never use worktree isolation** (`isolation: "worktree"`) for parallel agents. Worktrees create divergent copies of the repo that cause merge pain. Use regular agents with explicit file-ownership lists instead.

## Context Per Agent

**Required:** task title + description, relevant plan section, validation commands to run, explicit file-ownership list (files the agent may create/modify), instruction to commit before returning.

**Recommended:** 1-2 existing files as pattern references, boundary files (read-only), explicit list of files NOT to touch.

**Avoid:** sending the entire plan, assuming shared context, vague "follow patterns" without file refs.

Use `sonnet` model for implementation agents.

## Validation Contract

Every agent (implementation and fix) must:
1. Run the validation commands provided by the orchestrator.
2. Fix any issues found.
3. Commit changes before returning.
4. Report: what was done, what was committed, any unresolved issues.

## Conflict Prevention

- Verify file sets don't overlap before dispatching parallel agents. If they do: merge into one agent or serialize.
- Shared type files: one agent owns it, others read-only — OR extract as prerequisite task.
- If a parallel agent returns with merge conflicts, serialize remaining tasks in the group and resolve conflicts before continuing.
- **No destructive git commands.** Every agent prompt must include: "NEVER run `git stash`, `git reset`, or any destructive git command. If something breaks on files you didn't touch, ignore it and report back."
