---
name: engy:update-spec
description: "This skill should be used when the user asks to 'update spec status', 'sync spec with implementation', 'mark milestone complete in spec', 'refresh spec', or after completing milestones. Updates a project's specification documents with current implementation status."
---

# Master Spec Update Skill

This skill updates a Master Product Specification and all feature slice documents with current implementation status and planning document organization.

## MCP Tools

- `getProjectDetails(projectId)` — project paths (`specsDir`, `docsDir`)
- `listTasks(projectId)` — tasks with `specPath` for checking completion status
- `listMemories(projectId)` — recent decisions and context

Use MCP to discover paths/status, then Read/Edit/Glob for document updates.

## When to Use

- After completing major features or milestones
- When planning documents are added or reorganized
- When feature completion percentages change significantly
- When updating the product roadmap

## Process

### Step 1: Discover Documentation Structure

1. Ask user for project ID (or detect from current context).
2. Get `specsDir` and `docsDir` via `getProjectDetails`.
3. Use Glob to discover the documentation structure:
   ```
   Glob: {specsDir}/**/*.md
   Glob: {docsDir}/**/*.md
   ```
4. Identify the Master Spec (`spec.md`), feature slice documents, and planning docs from the directory listing.

### Step 2: Identify Document Types

From the discovered files, identify:
- **Master Spec**: `spec.md` in the project's spec directory
- **Feature Slices**: Subdirectories or top-level markdown files representing vertical feature areas
- **Planning Docs**: Documents in `projects/` or `docs/` subdirectories

### Step 3: Update Feature Slice Documents

For each feature slice:

1. **Gather current state:**
   - Implementation status from codebase (use Grep/Glob to check)
   - Related planning documents (Read files in the directory)
   - Related tasks via `listTasks`
   - Recent decisions via `listMemories`

2. **Update content** (use Edit tool):
   - Add newly completed features
   - Link to new planning documents
   - Update task references
   - Refresh any outdated information

### Step 4: Update Master Spec

Read and edit `spec.md` directly to update:

- Overview of all feature slices
- Links to each slice
- High-level status/maturity
- Technology stack (if changed)
- Architecture overview

### Step 5: Reorganize Planning Documents

When new planning documents are created:

1. **Determine feature slice** by analyzing document title/content and related tasks.
2. **Move the file** to the correct directory using Bash (`mv`).
3. **Update feature slice doc** to reference the new planning document.

### Step 6: Verify Hierarchy

Use Glob to check that:
- All planning docs are in the correct directory
- Master spec links to all feature slices
- Feature slices link to all their planning docs
- No orphaned documents
- Links are valid

## Common Feature Slices

Typical vertical slices (adapt to your project):
- Core domain features
- User experience & UI
- Data & persistence
- Integrations & APIs
- Infrastructure & tooling
- Security & auth

## Output Format

After updating, provide:

```markdown
## Master Spec Update Complete

### Project: <project-name>

### Updated Documents
- Master Spec
- <Feature Slice 1>
- <Feature Slice 2>
...

### Planning Documents Reorganized
- <Doc Title> → <Feature Slice>
...

### Changes Made
- <Summary of updates>
```

## Key Principles

- **Adapt to structure.** Every project organizes docs differently — discover before assuming.
- **Ask before proceeding.** If structure is unclear or documents are missing, list what was found and ask for clarification. Don't proceed with incomplete updates.
- **Check memory.** Use `listMemories` for recent completions and decisions that should be reflected in the spec.
- **Verify links.** After updating, confirm all cross-references and links are valid.

## Flow Position

**Previous:** `review` | **Next:** Back to `write-spec` for next milestone, or done

When spec documents are updated, the cycle for this milestone is complete. For the next milestone, return to `/engy:write-spec` to update the SRS, or proceed to `/engy:milestone-plan` if the spec is already current.
