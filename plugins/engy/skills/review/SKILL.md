---
name: review
description: "This skill should be used when the user asks to 'review changes', 'review my code', 'run a code review', 'review last commit', 'review recent changes', or 'check code against spec'."
---

# Code Review Orchestrator

Dispatch the `engy:reviewer` agent to simplify code directly, then surface severity-ordered findings.

## Inputs

- **Scope:** user-specified → arguments → auto-detect (uncommitted → last commit → branch diff)
- **Spec (optional):** only if user explicitly provides a spec/plan path for alignment checking

## Process

### Step 0: Determine Scope

Resolve the review scope. Show a summary: files changed, lines added/removed, directories affected.

Determine what are the features being implemented. Pass file paths to any relevant plans or tasks to the review agent.

**Resolution order:**
1. User-specified commit range, file list, or branch comparison
2. Arguments passed when invoked (e.g., "last commit", "staged changes")
3. Auto-detect: uncommitted changes (`git diff HEAD`) → last commit (`git diff HEAD~1..HEAD`) → branch diff against default branch

### Step 1: Dispatch engy:reviewer

Spawn the `engy:reviewer` agent via the Agent tool:

```
Agent tool:
  subagent_type: engy:reviewer
  mode: bypassPermissions
  prompt: |
    Review the following files changed in [scope description]:

    Changed files:
    - [list of file paths from the diff]

    Diff summary:
    [paste the git diff output or key changes]

    Project conventions: [path to CLAUDE.md if available]
    Features: [path to any plan files, tasks or features lists user provided one, otherwise omit]

    Run all three phases (Simplify, Apply, Review) on these files.

    If plan/spec files are provided, also validate requirements coverage:
    - Check each referenced FR in the plan
    - Confirm the implementation actually fulfills it end-to-end, not just that code exists
    - Report any FRs that are missing, only partially implemented, or not covered by tests
```

The agent runs three phases internally:
1. **Simplify** — five angles: reuse, simplification, efficiency, altitude, and the engineering principles it carries
2. **Apply** — direct code changes, no behavior modifications, no user approval
3. **Review** — findings tagged with severity, `file:line`, and an evidence rung

### Step 2: Verify Build

The agent already fixes and reverts its own breakage inside Phase 2, so this step is an independent
confirmation, not a second repair cycle. Its report that the gate passed is a rung-1 claim; run the
gate yourself (discovered from CLAUDE.md, package.json, or Makefile) and read the output.

If it still fails, the agent's own revert did not hold. Revert its simplification yourself with
`git checkout -- <files>` and keep the review findings, which are unaffected.

### Step 3: Present Results

Format the agent's output into the report below. Number all findings, sorted Critical → High → Medium.

## Output Format

```markdown
## Code Review: [scope description]

### Simplified
[Summary of direct changes made, or "No simplifications" / "Reverted due to build failure"]

### Issues
1. **[CRITICAL]** `file:line` — Description — rung N — Suggested fix: ...
2. **[HIGH]** ...
3. **[MEDIUM]** ...

### Requirements Coverage
[Only if plan/spec was provided. For each FR: VERIFIED / NOT VERIFIED / INCONCLUSIVE, the evidence
rung, and the artifact. Code existing for an FR is
rung 2, not coverage — an FR with no test that exercises it is INCONCLUSIVE.]

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
- **Build verification** — confirm the gate yourself; the agent's "it passed" is a rung-1 claim
- **Every finding:** file:line + concrete suggestion

## Additional resources

- For the evidence ladder and the three verdicts, see [../implement/references/evidence-ladder.md](../implement/references/evidence-ladder.md)

## Flow Position

**Previous:** `implement` | **Next:** `complete-project`

When the code review is complete and all critical/high issues are resolved, commit the work. Once the project's tasks are all in `done` status, proceed with `/engy:complete-project` to distill knowledge and archive it.
