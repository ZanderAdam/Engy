---
name: plan
description: "This skill should be used when the user asks to 'write a plan', 'plan implementation', 'plan milestone', 'create implementation plan', or when planning complex changes — new features, architecture changes, multi-file work, or anything with ambiguous scope. Writes a validated implementation plan using codebase-aware requirements engineering."
---

# Requirements-First Planning

Write a validated implementation plan for a standalone task using a codebase-aware requirements engineering process.

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specDir`) + workspace context
- `listTasks(projectId)` — milestone tasks (responses include `specPath`)
- `listTaskGroups(milestoneRef)` — task groups within the target milestone

Use MCP to discover context, then Read/Glob/Grep for codebase exploration and spec reading.

## EARS-BDD Mode

Check whether EARS-BDD is enabled for this workspace — the agent's appended system prompt or `getWorkspaceDetails` will indicate it (`earsBdd: true`). When enabled, the `## Functional Requirements` section is written as `| FR-<AREA>-<NNN> | <EARS SHALL text> |` table rows (the reference's format) — **not** the numbered "The system shall…" list with source tags shown in the templates below. Reuse the spec/milestone ids the task draws on, and allocate a new durable id only for behaviour the task itself introduces. Follow the planning augmentations in `../implement/references/ears-bdd.md` for FR-graph orientation (use the area's existing FRs + `trace` to find current behaviour, tests, and code before exploring), the id scheme, allocation rule, and funnel discipline. When disabled, write FRs using the format in the templates below unchanged.

## Output Location

Write the plan to the path given in the prompt. When no path is given and the
plan belongs to a task, write it to
`{projectDir}/plans/{workspace-slug}-T{task-id}-{short-slug}.plan.md`, where
`{short-slug}` is 2-5 kebab-case words describing the task — for example
`engy-T123-add-api-routing.plan.md`. The `{workspace-slug}-T{task-id}` prefix is
mandatory; Engy finds the plan by that prefix.

When replanning, keep the filename the existing plan already has. A rename
detaches the plan review comments, which are keyed by file path.

## Step 0: Triage

Assess complexity before committing to the full process:

- **Simple** (clear scope, 1-2 files, established patterns, no architectural decisions): Skip to Step 3 — write using the **Lightweight Template** below and present for approval.
- **Complex** (ambiguous scope, 3+ components, new patterns, cross-cutting concerns, or user explicitly requested planning): Proceed to Step 1. Output uses the **Standard Template** below.

Default to **full process**. The simple path is the exception, not the rule.

## Step 0.5: Research Prior Knowledge

Before writing the plan body, dispatch the `engy:research` subagent to surface relevant prior decisions, patterns, and gotchas from the workspace knowledge graph.

**Resolve `workspaceId` first.** If not already known from context, call `listWorkspaces` (or `getWorkspaceDetails`) to obtain it before dispatching — `engy:research` hard-errors without it.

```
Task({
  subagent_type: 'engy:research',
  prompt: '<task description> — context: project=<slug>, milestone=<id>, repo=<repo-or-empty> workspaceId=<id>'
})
```

The subagent returns a digest with 3–8 cited findings. Fold the digest directly into the plan document, wrapped in markers:

```markdown
<!-- engy:research synthesized YYYY-MM-DD -->
<digest content>
<!-- /engy:research -->
```

Place this block in the **Overview** section or immediately before the **Implementation Sequence**. The markers let future readers identify LLM-synthesized content and re-run the research step against current memory state.

If the subagent returns `No relevant prior knowledge found for this question.` (i.e., `Distinct findings: 0 (after dedup)` in the footer), omit the marker block entirely — do not write an empty block.

When the work is repo-local, include `filters.repo` in the prompt so the subagent applies repo-scoped ranking. Skip this step only for **Simple** (lightweight) plans where the task is clearly understood from the codebase alone.

## Step 1: Elicit (Internal Pass, then External Pass)

### 1a. Internal Pass (no user interaction)

Explore the codebase first: CLAUDE.md, project structure, existing patterns for similar features, dependencies, recent commits touching related areas. If planning a milestone, review the milestone scope, its tasks, and the parent spec for context.

Infer requirements from the request plus codebase context. For each inference, note its source (e.g., "soft deletes — matches existing User model pattern"). Consider: loading states, error handling, empty states, mobile behavior, accessibility, data persistence.

Stress-test the inferred requirements against these categories:
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

Before surfacing a question, classify it. If a **cheap** probe settles it — a script, a query, running the code and looking — run the probe and present the result instead of asking. A question whose answer is an observable fact is not the user's to answer, and a result they can react to beats a decision they have to make. Keep asking when the probe would cost more than the answer is worth, and always for preference and business calls no experiment can settle.

Run for up to 3 rounds. After each response, re-evaluate: did answers surface new unknowns? If everything is clear, move to Step 2. Do not ask questions for the sake of filling rounds — stop as soon as requirements are unambiguous.

## Step 2: Analyze

Cross-check all gathered requirements (user-stated + inferred + elicited) for:

- **Conflicts** — requirements that contradict each other
- **Codebase conflicts** — requirements that contradict existing architecture or conventions
- **Implicit dependencies** — requirement A silently requires B
- **Priority** — must-have vs. deferrable
- **Blast radius** — what else consumes the thing being changed

Listing the callers is not the blast radius; a symbol search finds those in a second. The risk is
the coupling a symbol search cannot see, so check the paths it misses: the shape of data crossing a
process or network boundary, a stored schema or migration, a serialized format something else
parses, another language or service reading the same bytes, a config or feature flag, and consumers
three hops downstream. Also read the source of any library whose behaviour the change depends on,
and note its pinned version.

Most changes that look frightening are safe because of one specific fact ("this only drops entries
already marked dead"). Find that fact and state it. Time spent proving it beats a long list of
maybes, and the risks that survive it belong in the plan with a way to check each one.

This is an internal reasoning step. If conflicts are found, present them to the user with resolution options before proceeding. If no conflicts, proceed to Step 3.

## Step 3: Specify

Synthesize everything into a structured plan using the appropriate template:

- **Lightweight**: Overview, Changes (with inline test impact), Verification.
- **Standard**: Overview, Functional Requirements, Non-Functional Requirements (if relevant), Codebase Context (patterns + affected files table), Implementation Sequence (ordered steps with inline test impact + parallelization notes), Out of Scope, Open Questions. Optionally: Test Scenarios (only for complex stateful flows).

**Test guidance:** FRs define expected behavior. Implementation Sequence steps include inline test impact. These two cover most testing needs. Only add a separate Test Scenarios section (Gherkin) when the feature has complex multi-step stateful flows where temporal ordering matters and can't be captured in a single FR.

**Code snippets:** For non-obvious changes (e.g., reversing a sort direction, changing a filter predicate), include before/after code snippets inline with the relevant step or change row.

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

## Lightweight Template

```markdown
# Plan: [Feature/Change Name]

## Overview
What we're changing and why. 2-3 sentences.

## Changes

### `path/to/file.ts`
What changes. Include before/after snippets for non-obvious changes.
- *Test impact:* Which tests are affected and how.

### `path/to/other-file.ts`
...

## Verification
How to confirm the change works end-to-end.

**Parallelizable:** (optional) Note which changes can run concurrently.
```

## Standard Template

```markdown
# Plan: [Feature/Change Name]

## Overview
One paragraph: what we're building, why, and the scope boundary.

## Functional Requirements
Numbered list. Each requirement is one clear behavior the system must exhibit.
Use "The system shall..." or "When [trigger], [behavior]" format.
Tag each with its source: (user request), (inferred: <reason>), (elicited).
Group by feature area if more than 5.

## Non-Functional Requirements
Only include what's relevant: performance targets, security constraints,
accessibility, compatibility, data handling, error recovery.

## Codebase Context

**Patterns:** Key conventions, established patterns, and existing infrastructure
the implementation must follow. Keep brief — just what's needed to inform
implementation decisions.

**Affected files:**

| File | Tag | Current Role → Change |
|------|-----|----------------------|
| `path/to/file.ts` | MODIFY | Current role → what changes |
| `path/to/new-file.ts` | NEW | What this new file does |

## Implementation Sequence
Ordered list of build steps. Each step references affected files by name
without re-describing what changes (that's in the table above). Focus on
ordering, dependencies, and test impact.

1. **Step name** — What to build/change. (dependencies: none | depends on step N)
   - *Test impact:* Which tests are affected and how. Include before/after
     snippets for non-obvious changes.

**Parallelizable:** Steps X, Y, Z have no dependencies and can run concurrently.

## Test Scenarios (optional)
Include only for complex multi-step stateful flows where temporal ordering
matters and can't be captured in a single FR. Group by feature area.

### {Feature Area}

```gherkin
Scenario: {descriptive name} (FR #{N})
  Given {precondition}
  When {action}
  Then {expected outcome}
```

## Out of Scope
Explicit list of what this work does NOT include, to prevent scope creep.

## Open Questions
Anything still ambiguous after elicitation that the user should weigh in on
before implementation starts. Omit this section entirely if there are none.
```

## Flow Position

**Previous:** `milestone-plan` | **Next:** `validate-plan`

When the plan is approved by the user, proceed with `/engy:validate-plan` to validate it against the parent spec before implementation.
