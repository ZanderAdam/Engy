---
name: engy:plan
description: "This skill should be used when the user asks to 'write a plan', 'plan implementation', 'plan milestone', 'create implementation plan', or when planning complex changes — new features, architecture changes, multi-file work, or anything with ambiguous scope. Writes a validated implementation plan using codebase-aware requirements engineering."
---

# Requirements-First Planning

Write a validated implementation plan for a milestone (or standalone task) using a codebase-aware requirements engineering process. This skill is typically used after `/engy:milestone-plan` has created milestones and tasks — you are now planning the detailed implementation approach for a specific milestone.

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specDir`) + workspace context
- `listTasks(projectId)` — milestone tasks (responses include `specPath`)
- `listTaskGroups(milestoneRef)` — task groups within the target milestone

Use MCP to discover context, then Read/Glob/Grep for codebase exploration and spec reading.

## Step 0: Triage

Assess complexity before committing to the full process:

- **Simple** (clear scope, 1-2 files, established patterns, no architectural decisions): Skip to Step 3 — write a brief inline plan using the Specify template and present for approval.
- **Complex** (ambiguous scope, 3+ components, new patterns, cross-cutting concerns, or user explicitly requested planning): Proceed to Step 1.

Default to **full process**. The simple path is the exception, not the rule.

## Step 1: Elicit (Internal Pass, then External Pass)

### 1a. Internal Pass (no user interaction)

Explore the codebase first: CLAUDE.md, project structure, existing patterns for similar features, dependencies, recent commits touching related areas. If planning a milestone, review the milestone scope, its tasks, and the parent spec for context.

**As Interviewee** — infer requirements from the request plus codebase context. For each inference, note its source (e.g., "soft deletes — matches existing User model pattern"). Consider: loading states, error handling, empty states, mobile behavior, accessibility, data persistence.

**As Interviewer** — stress-test the inferred requirements against these categories:
- **Components** — What pieces are involved? What existing code is affected?
- **Workflow** — What's the happy path, step by step?
- **Minimum scope** — What's the smallest version that works? What can defer?
- **Constraints** — Error states, edge cases, permissions, concurrency, performance.
- **Boundaries** — What should this explicitly NOT do or touch?

For each gap found, classify it:
- **Resolvable from code** — resolve it internally, record the resolution
- **Needs user judgment** — surface it in the External Pass

For greenfield projects with no existing code, the Internal Pass is brief. Focus shifts to the External Pass.

### 1b. External Pass (user interaction)

Present: "Based on the codebase, I plan to [summary]. I need your input on these [N] things:"

Each question should state what was inferred and why user judgment is needed, with tradeoffs where applicable. Only surface questions the codebase cannot answer — business decisions, preferences, and ambiguous tradeoffs.

Run for up to 3 rounds. After each response, re-evaluate: did answers surface new unknowns? If everything is clear, move to Step 2. Do not ask questions for the sake of filling rounds — stop as soon as requirements are unambiguous.

## Step 2: Analyze

Cross-check all gathered requirements (user-stated + inferred + elicited) for:

- **Conflicts** — requirements that contradict each other
- **Codebase conflicts** — requirements that contradict existing architecture or conventions
- **Implicit dependencies** — requirement A silently requires B
- **Priority** — must-have vs. deferrable

This is an internal reasoning step. If conflicts are found, present them to the user with resolution options before proceeding. If no conflicts, proceed to Step 3.

## Step 3: Specify

Synthesize everything into a structured plan following the template at `references/plan-template.md`. The template covers: Overview, Codebase Context, Affected Components, Functional Requirements, Non-Functional Requirements, Workflow, **Test Scenarios**, Out of Scope, Implementation Sequence, and Open Questions.

**Test Scenarios are mandatory.** Write Gherkin-format scenarios (Given/When/Then) that cover each feature area. Group by functional area. Reference the FR numbers each scenario validates (e.g., "Scenario: Get file diff (FR #2, #6)").

## Step 4: Validate

Before presenting the plan, review it against these checks:
- Are any functional requirements ambiguous or contradictory?
- Does the implementation sequence have unstated dependencies?
- Does anything violate the Out of Scope section?
- Are there inferred requirements that didn't make it into the plan?
- Is the scope actually minimal, or did it creep?
- Do any requirements conflict with existing codebase conventions or architecture?

If issues are found, fix them inline. Note any tradeoffs or judgment calls at the bottom of the plan for user review.

**Do NOT start implementation until the user explicitly approves the plan.** Present the plan and wait. Once approved, proceed with `/engy:validate-plan` to validate it against the parent spec before implementation. If something architectural surfaces mid-build that wasn't in the plan, stop and flag it.

## Additional Resources

### Reference Files

- **`references/plan-template.md`** — Structured plan template with all required sections

## Flow Position

**Previous:** `milestone-plan` | **Next:** `validate-plan`

When the plan is approved by the user, proceed with `/engy:validate-plan` to validate it against the parent spec before implementation.
