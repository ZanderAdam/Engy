---
name: engy:review
description: "This skill should be used when the user asks to 'review changes', 'review my code', 'run a code review', 'review last commit', 'review recent changes', or 'check code against spec'."
---

# Code Review Orchestrator

Dispatch the `engy-reviewer` agent to simplify code directly, then surface severity-ordered findings.

## Inputs

- **Scope:** user-specified → arguments → auto-detect (uncommitted → last commit → branch diff)
- **Spec (optional):** only if user explicitly provides a spec/plan path for alignment checking

## Process

### Step 0: Determine Scope

Resolve the review scope. Show a summary: files changed, lines added/removed, directories affected.

**Resolution order:**
1. User-specified commit range, file list, or branch comparison
2. Arguments passed when invoked (e.g., "last commit", "staged changes")
3. Auto-detect: uncommitted changes (`git diff HEAD`) → last commit (`git diff HEAD~1..HEAD`) → branch diff against default branch

### Step 1: Dispatch engy-reviewer

Spawn the `engy-reviewer` agent via the Agent tool:

```
Agent tool:
  subagent_type: engy-reviewer
  mode: bypassPermissions
  prompt: |
    Review the following files changed in [scope description]:

    Changed files:
    - [list of file paths from the diff]

    Diff summary:
    [paste the git diff output or key changes]

    Project conventions: [path to CLAUDE.md if available]
    Spec: [path to spec if user provided one, otherwise omit]

    Run both phases (Simplify then Review) on these files.
```

The agent runs two phases internally:
1. **Simplify** — direct code changes, no behavior modifications, no user approval
2. **Review** — surface findings tagged with severity and file:line

### Step 2: Verify Build

After the agent completes, run the project build/test command (discovered from CLAUDE.md, package.json, or Makefile).

If simplification broke the build: agent fixes (2 attempts max), then reverts simplification and keeps review findings.

### Step 3: Present Results

Format the agent's output into the report below. Number all findings, sorted Critical → High → Medium.

## Output Format

```markdown
## Code Review: [scope description]

### Simplified
[Summary of direct changes made, or "No simplifications" / "Reverted due to build failure"]

### Issues
1. **[CRITICAL]** `file:line` — Description — Suggested fix: ...
2. **[HIGH]** ...
3. **[MEDIUM]** ...

### Summary
[2-3 sentences: assessment, severity counts, recommendation]
```

## Severity

- **Critical** — Breaks correctness, security vulns, data loss
- **High** — Architectural violations, missing error handling, wrong dependency direction
- **Medium** — Pattern inconsistencies, naming, readability, minor test gaps

## Key Principles

- **Orchestrate, do not review** — dispatch the agent, format results
- **Simplification is autonomous** — no approval needed, no behavior changes
- **Single agent, single pass** — saves tokens
- **Build verification** — if simplification breaks build, fix or revert
- **Every finding:** file:line + concrete suggestion

## Flow Position

**Previous:** `implement-plan` | **Next:** `update-spec`

When the code review is complete and all critical/high issues are resolved, proceed with `/engy:update-spec` to update the master spec with implementation status.
