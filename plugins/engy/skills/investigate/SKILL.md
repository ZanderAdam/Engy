---
name: investigate
description: "This skill should be used when the user asks to 'investigate X', 'look into X and file a task', 'research and track X', 'create a task from finding', or wants to explore a codebase concern and capture it as a tracked work item."
---

# Investigate and File

Explore a concern in the codebase, synthesize the finding, and create a well-documented task — so nothing gets lost and the implementer has everything they need without re-doing the investigation.

## MCP Tools

- `getWorkspaceDetails(workspaceId)` — workspace info + project list (find default via `isDefault: true`)
- `createTask(projectId, ...)` — file the finding as a task against the default project

Use Grep/Glob/Read for codebase exploration. For investigations requiring more than 3 queries, delegate to the Explore agent.

## Workflow

### Step 1: Clarify scope (if ambiguous)

If the request is vague (no concrete symptom, file, or behavior named), ask **one** clarifying question before proceeding. If the request is specific enough to start, proceed immediately — do not ask for the sake of asking.

### Step 2: Explore the codebase

Use Grep, Glob, and Read to locate the relevant code. For broad investigations (more than 3 targeted queries), spawn an Explore agent with a focused prompt so the search is thorough and systematic.

Rules:
- Cite every finding as `path/to/file.ts:line` — no file references without line numbers.
- Record every grep run, every file read, and every agent spawned. These become the **Steps taken** section of the task body.
- Stop exploring when you have enough to write a self-contained problem statement. Do not over-explore.

### Step 3: Summarize the finding in chat

Before creating the task, present the finding to the user:

- **Current behavior** — what the code does today, with `file:line` citations.
- **Why it is wrong / confusing / missing** — the specific problem.
- **1–3 fix approaches** with a brief recommendation.

This gives the user a chance to redirect before the task is filed.

### Step 4: Create the task

Resolve the default project:

```
getWorkspaceDetails(workspaceId)
  → projects[].find(p => p.isDefault)
  → projectId
```

Call `createTask` with:

- `projectId` — the default project's ID
- `title` — concise, action-oriented (e.g., "Fix stale cache on workspace rename")
- `type: "ai"`
- `importance` / `urgency` — see priority rules below
- `body` — structured markdown (see template below)

#### Task body template

```markdown
## Problem
One paragraph: what is wrong, confusing, or missing. No file refs needed here — those go in Current behavior.

## Current behavior
Describe what the code does today. Cite every claim with `path/to/file.ts:line`.

## Desired behavior
What the code should do instead, or what should exist.

## Approach options
1. **Option A** — description, tradeoffs.
2. **Option B** — description, tradeoffs.
3. **Option C** (if applicable) — description, tradeoffs.

**Recommendation:** Option A because [reason].

## Scope
What is in scope for this task. What is explicitly out of scope.

## Acceptance
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Steps taken
Exact exploration trail so the implementer doesn't repeat work:
- Grep: `<pattern>` in `<path>` → found `<result>`
- Read: `path/to/file.ts` lines N–M → noted <observation>
- Explore agent: "<prompt>" → key finding

## Final task
run /engy:review, run pnpm blt and test in chrome
```

#### Priority rules

| Signal | importance | urgency |
|--------|------------|---------|
| No explicit signal (default) | `important` | `not_urgent` |
| User says "bug" or "broken" | `important` | `urgent` |
| User says "minor" or "nice to have" | `not_important` | `not_urgent` |
| User says "blocking" | `important` | `urgent` |

### Step 5: Report back

Reply with:
- The created task ID and its one-line title.
- A one-sentence summary of the finding.

**Do NOT start implementing.** Stop here.

## Multiple findings

If the investigation surfaces multiple distinct problems, file a separate task for each one. Each task must carry its own **Steps taken** trail — do not share a single trail across tasks.

## Key Principles

- **Investigate before filing.** Never create a vague stub task. Every task must have `file:line` citations and a concrete problem statement before it is filed.
- **Self-contained tasks.** The implementer must be able to pick up the task cold, without re-running the investigation. Every claim in the task body needs a citation.
- **Stop at task creation.** This skill produces a tracked task, not a plan, not a PR. Proceed to `/engy:plan` only when explicitly asked.
- **One concern per task.** If exploration reveals multiple distinct issues, file them separately. Do not bundle unrelated findings into a single task.

## Flow Position

This skill is a capture utility. It feeds into the standard workflow: `investigate` → `plan` → `implement`.
