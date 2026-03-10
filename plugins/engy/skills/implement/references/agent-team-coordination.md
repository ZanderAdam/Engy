# Agent Team Coordination

## When to Parallelize

Parallelize when sub-tasks touch **non-overlapping file sets**, have **no shared state**, and are **independently testable**. When in doubt, serialize — merge conflicts cost more than time saved.

## Context Per Agent

**Required:** sub-task description + acceptance criteria, test scenarios, file paths, area test command.

**Recommended:** 1-2 existing files as pattern references, boundary files (read-only), explicit list of files NOT to touch.

**Avoid:** sending entire plan, assuming shared context, vague "follow patterns" without file refs.

## Conflict Prevention

- Verify file sets don't overlap before dispatch. If they do: merge into one sub-task or serialize.
- Shared type files: one agent owns it, others read-only — OR extract as prerequisite sub-task.
- Review combined diff before committing. Fix conflicts inline rather than re-dispatching.
