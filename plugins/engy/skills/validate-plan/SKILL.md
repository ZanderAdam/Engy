---
name: engy:validate-plan
description: "This skill should be used when the user asks to 'validate a plan', 'check plan against spec', or 'verify plan alignment'. Validates a project plan against its parent spec for alignment, missing requirements, and consistency."
---

# Project Document Validation

Validate a project document (plan, RFC, design doc) against its parent spec to identify alignment gaps, missing requirements, inconsistencies with existing infrastructure, and scoping issues.

## When to Use

- Validating a milestone plan against its spec before implementation
- Checking an RFC or design doc against the vision/requirements it implements
- Reviewing any derived document for faithfulness to its source spec

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specDir`, `docsDir`) for locating spec and plan
- `listTasks(projectId)` — tasks with `specPath` for cross-referencing plan against task structure

Use MCP to discover paths, then Read/Glob/Grep for content analysis.

## Inputs

Identify two artifacts:
1. **Document under review** (the plan/RFC/design doc)
2. **Source spec** (the spec or vision document it derives from, including context files)

If the user provides file paths, read them directly. If referencing engy project docs, resolve paths via `getProjectDetails`.

## Process

### Phase 1: Gather All Source Material

Read these in parallel:

1. **The document under review** in full
2. **The source spec** (`spec.md` or vision doc)
3. **All context files** in the spec's `context/` directory
4. **Current codebase state** relevant to the document's scope

Given a project file `./projects/initial/m2-plan.md` the spec directory is likely `./specs/initial/`.

For codebase exploration, spawn an agent (`subagent_type: Explore`) to report on:
- Database schema (exact tables, columns, types)
- API surface (tRPC routers, procedures, MCP tools)
- Existing infrastructure (WebSocket protocol, file watchers, test setup)
- Installed dependencies
- UI structure (pages, components, layouts)

This prevents validating against an imagined codebase rather than the real one.

### Phase 2: Extract Requirements from Spec

From the source spec and its context files, extract:

1. **Explicit requirements** - Directly stated behaviors, entities, lifecycles, data structures
2. **Lifecycle/state machines** - All states and valid transitions for every entity
3. **Architectural constraints** - Storage decisions, communication patterns, integration points
4. **UI/UX requirements** - Layout, interaction patterns, navigation, component behavior
5. **Cross-cutting concerns** - Security, validation, error handling, IDE integration

Organize into a checklist. Consult `references/validation-checklist.md` for the full category breakdown.

### Phase 3: Validate Alignment

For each extracted requirement, check the document under review:

**Coverage check** - Is the requirement addressed? Mark as: covered, partially covered, missing, or explicitly deferred.

**Correctness check** - Where addressed, does the document faithfully represent the spec? Watch for:
- Lifecycle states/transitions that are incomplete or reordered
- Entity fields that differ from spec definitions
- Scoping that's too narrow or too broad
- Behaviors that contradict the spec

**Infrastructure consistency** - Does the document account for what already exists?
- Reuses existing tables/columns rather than duplicating
- Builds on existing WebSocket messages, API patterns, test helpers
- Follows established conventions (naming, file structure, error handling)
- Avoids adding dependencies when existing ones suffice
- Avoids redundant infrastructure (e.g., new file watchers when daemon already watches)

**Boundary check** - Does the document respect its stated scope?
- No features claimed that belong to other milestones
- Out-of-scope section matches the spec's phasing
- Deferred items are genuinely deferrable without breaking the delivered feature

### Phase 4: Produce Report

Structure the output as:

```markdown
## [Document Name] Validation Against [Spec Name]

### Alignment: What the Document Gets Right
[Numbered list of correctly implemented spec requirements with line references to both documents]

### Issues Found

#### Severity: High
[Issues that would cause incorrect behavior or violate spec requirements]

#### Severity: Medium
[Inconsistencies with existing infrastructure, enforcement gaps, missing scoping]

#### Severity: Low
[Design preferences, minor gaps, non-blocking observations]

### Missing from Document (Not Bugs, but Gaps)
[Spec requirements not addressed — note which are legitimately out of scope vs overlooked]

### Summary
[2-3 sentence assessment: overall alignment quality, main risks, recommendation]
```

## Severity Classification

**High** - Spec violations: missing lifecycle states, incorrect state machines, wrong entity relationships, missing required fields, broken invariants.

**Medium** - Infrastructure inconsistencies: ignoring existing patterns, redundant mechanisms, missing enforcement for stated constraints, scoping gaps in API design.

**Low** - Design preferences: dependency choices, naming conventions, restriction policies, minor UX details not specified by the spec.

## Key Principles

- **Spec is truth.** The source spec defines what's correct. The document under review must be faithful to it.
- **Codebase is context.** The existing implementation constrains what's possible and what's consistent. Always verify against actual code, not assumptions.
- **Explicit > implicit.** If the spec says something, the document should address it — even if only to say "deferred to M[N]."
- **Severity matters.** Not all gaps are equal. A missing lifecycle state is high severity; a dependency preference is low.
- **Quote your sources.** Reference specific lines/sections in both the spec and the document when citing issues.

## Additional Resources

### Reference Files

- **`references/validation-checklist.md`** - Detailed checklist of validation categories with specific items to verify

## Flow Position

**Previous:** `plan` | **Next:** `implement` or `implement-milestone`

When the plan passes validation (no high-severity issues remaining), proceed with `/engy:implement` for single-task work or `/engy:implement-milestone` for milestone-level implementation.
