---
name: engy:write-spec
description: "Creates or validates a Software Requirements Specification from source documents, and manages spec context files. Use when asked to 'write a spec', 'create SRS', 'generate spec', 'author spec', 'spec from vision', 'validate spec', 'review spec', 'check SRS', 'validate SRS against context', 'save context', 'add context file', or 'save this as context'."
---

# Spec Authoring & Validation

Generate, update, or validate a Software Requirements Specification (SRS) from source documents (vision docs, context files, milestones). Covers the full spec authoring lifecycle: template discovery, SRS generation, incremental updates, cross-reference validation, and in-place fixes.

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specDir`, `docsDir`) for locating spec
- `getWorkspaceDetails(workspaceId)` — workspace paths if project ID is unknown

Use MCP to discover paths, then Read/Glob/Grep for spec content.

## When to Use

- Creating a new `spec.md` from context files
- Updating an existing `spec.md` after source documents changed (new context files, revised vision, added milestones)
- Validating an existing `spec.md` against its source documents
- Reviewing an SRS for missing requirements, inconsistencies, or template gaps
- Saving or managing context files in `{specDir}/context/`

## Mode Detection

Determine mode from user intent and filesystem state:

- **Generate mode** — No `spec.md` exists in the target directory, or user explicitly asks to create/write/generate a spec
- **Update mode** — `spec.md` exists and user asks to update/sync/add requirements (source docs have changed)
- **Validate mode** — `spec.md` exists and user asks to validate/review/check (read-only analysis + fixes)
- **Context mode** — User asks to save/add/manage context files, or substantial context is gathered during conversation

## Process

### Step 1: Locate Spec Template

Search for a workspace-level template in this order:

1. **Workspace specs directory**: `**/specs/spec.template.md`

If found, read and use it as the structural template. If not found, read the bundled fallback at `references/spec-template.md` within this skill directory.

### Step 2: Gather Source Material

If the user specifies which files to use, use those. Otherwise, read ALL files in the target spec directory and its subdirectories:

1. **Vision/spec doc** — The main document (e.g., `initial.vision.md`, or existing `spec.md` in validate mode)
2. **Context files** — Everything in `context/` subdirectory (UI design, workflows, filesystem structure, etc.)
3. **Related project docs** — Check for milestone/plan docs in sibling `projects/` or `docs/projects/` directories that reference this spec

Read every file completely before proceeding. Missing a source doc means missing requirements.

### Step 3: Execute Mode

#### Generate Mode

Write `spec.md` following the template structure section by section:

1. **Frontmatter** — Add YAML frontmatter: `title`, `status: draft`, `type: buildable` (or `vision`)
2. **Sections 1-7** — Standard SRS content extracted from source docs:
   - Extract definitions from all terms used across source docs
   - Extract functional requirements by reading source docs paragraph by paragraph — every described behavior, lifecycle, interaction, and architectural decision becomes an FR
   - Map FRs to milestones if milestone docs exist
3. **Sections 8-14** — Implementation sections. For vision-level specs, add pointers to milestone-level plans. For milestone-level specs, include file maps, implementation phases, behavioral requirements (Gherkin), key decisions, verification checklists.

After generation, automatically proceed to validation (Validate Mode below).

#### Update Mode

Source documents have changed (new context files added, vision doc revised, milestones updated). Incrementally update the existing `spec.md`:

1. **Diff source material** — Compare gathered source docs against what the current SRS covers. Identify new content, changed content, and removed content.
2. **Add new requirements** — For new behaviors/features in source docs, add FRs to the appropriate feature section using the next available FR ID. Add corresponding definitions, stimulus/response entries, and milestone mappings.
3. **Update changed requirements** — For revised source content, update the corresponding FRs, definitions, and data model entries to match.
4. **Flag removals** — If source content was removed, flag the orphaned FRs for human review rather than deleting (the removal may be intentional or accidental).
5. **Update milestone table** — Adjust FR ranges and exit criteria for affected milestones.
6. **Add revision history entry** — Document what changed and why.

After update, automatically proceed to validation (Validate Mode below).

#### Validate Mode

Dispatch the `engy-srs-reviewer` agent to validate and fix the SRS in place:

```
Agent tool:
  subagent_type: engy-srs-reviewer
  mode: bypassPermissions
  prompt: |
    Validate the SRS at [path/to/spec.md] against all source documents
    in [path/to/spec-directory/].

    Source files to cross-reference:
    - [list every file path found in Step 2]

    Spec template structure to validate against:
    - [path to template found in Step 1]

    Your task:
    1. Read ALL source files thoroughly
    2. Cross-reference the SRS against each source document
    3. Fix inconsistencies by editing spec.md directly
    4. Report a summary of all changes made

    Scope: ONLY look at files within the spec directory. Do not explore
    outside code or other directories.
```

#### Context Mode

Manage files in `{specDir}/context/`. Context files are supplementary documents that feed into spec generation — UI designs, workflows, architecture decisions, research findings, etc.

**Explicit save** — User asks to save something as context (e.g., "save this as context", "add this design doc"):

1. Resolve `{specDir}/context/` via `getProjectDetails`.
2. Generate a descriptive slug for the filename (e.g., `ui-wireframes.md`, `auth-workflow.md`, `filesystem-structure.md`).
3. Write the content to `{specDir}/context/{slug}.md`.
4. List existing context files so the user sees what's there.

**Auto-save** — During Generate or Update mode, if substantial context surfaces in conversation (design decisions, workflow descriptions, UI sketches, architectural constraints) that isn't already captured in existing context files:

1. After gathering source material (Step 2), identify information from the conversation that would be lost when the session ends.
2. Offer to save it: "I found substantial context about [topic] that isn't in your context files. Save as `context/{slug}.md`?"
3. Only save after user confirms.

**Naming conventions** for context files:
- Use descriptive slugs: `ui-design.md`, `data-model.md`, `auth-flow.md`, `api-contracts.md`
- Prefix with category when helpful: `workflow-`, `design-`, `architecture-`
- Avoid generic names like `notes.md` or `context-1.md`

### Step 4: Present Results

After the agent completes, present:

1. **Changes made** — Summary of definitions added, FRs added/corrected, milestone updates
2. **Issues requiring human judgment** — Contradictions between source docs, ambiguous requirements, scope decisions
3. **Context doc inconsistencies** — Problems found in source docs themselves (not SRS errors)

## Severity Framework

When reporting findings:

- **High** — Missing or incorrect FRs, contradictions with source docs, missing lifecycle states, broken invariants
- **Medium** — Missing definitions, underspecified FRs, terminology inconsistencies, template structure gaps
- **Low** — Formatting, minor wording, style preferences

## Key Principles

- **Source docs are truth.** The vision doc and context files define what's correct. The SRS must faithfully capture them.
- **Read everything.** Missing a context file means missing requirements. Read every file in the spec directory before generating or validating.
- **Template first.** Always check for a workspace-level template before falling back to the bundled reference.
- **Fix in place.** The agent edits spec.md directly for objective fixes. Subjective issues are flagged for human decision.
- **Track changes.** Always add a revision history entry documenting what was changed and why.

## Flow Position

**Previous:** Entry point | **Next:** `milestone-planner`

When the SRS is complete and approved, ask the user if we should proceed with `/engy:milestone-planner` to decompose the spec into milestones, task groups, and tasks. DO NOT AUTOMATICALLY DISPATCH THE PLANNER — the user must explicitly approve it after reviewing the final SRS.
