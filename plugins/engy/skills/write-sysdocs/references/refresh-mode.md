# Refresh Mode

Runs after project completion or memory review. Analyzes completed tasks and promoted memories, then proposes system doc updates for prose and technical docs. Exits cleanly when there is nothing to surface.

## Work-List Step (Step 2 of shared engine)

### Read Project Context

After resolving workspace (Step 1 of shared engine), also call:

```
getProjectDetails({ projectId })
```

to get the project name, `workspaceId`, workspace slug, and filesystem paths. If no project is in context, skip `getProjectDetails` and work from memories alone.

Then run these in parallel:

**Completed tasks:**

```
listTasks({ projectId, status: 'done', compact: false })
```

Also fetch tasks with status `'review'` or `'in_progress'` for in-progress context. (The `tasks` status enum is `backlog | todo | in_progress | review | done` — there is no `active` status.)

**Permanent memories:**

```
listMemories({ workspaceId, scope: 'permanent', compact: false })
```

With `scope: 'permanent'` this returns a wrapped object `{ permanent: Memory[] }` — read `result.permanent` for the array.

**Existing system docs:** enumerate `systemDir` with Glob/Read. If `search` is available, use it to scope which existing docs to read:

```
search({ workspaceId, query: '<project summary or focus area>', collection: 'system', limit: 10 })
```

### Nothing-to-Surface Gate

If `listMemories` returned zero permanent memories **and** the `engy:research` digest (Step 3 of the shared engine) reported no findings **and** there are no completed tasks with actionable signal, print:

```
No new knowledge to surface — system docs are up to date.
```

and exit without writing any files.

### Gap Analysis

Based on completed tasks + promoted memories + research digest, identify what is missing or outdated in `{workspaceDir}/system/`:

- **Existing technical doc outdated** — behavior changed, new edge cases emerged, or a promoted memory contradicts or extends the current doc.
- **Architectural decision worth capturing** — a significant design choice made during the project belongs in `system/technical/<topic>.md`.
- **Cross-references to add** — `memoryRefs` frontmatter missing from existing docs.
- **New technical doc needed** — a completed concern has no corresponding `system/technical/<topic>.md`.

Discard trivial changes (typos, minor wording) — only propose docs that carry actionable signal for future work.

If the gap analysis identifies a feature doc (`system/features/<area>.md`) as needing creation or update, remove it from this mode's work-list and emit the handoff to `engy:feature-docs` per the shared engine rules.

Return the work-list to the shared engine for Steps 3–6.

## Summary Format

```
System doc refresh complete.

Files proposed:
  EDIT    system/technical/db-schema.md    — adds nullable `promotedAt` column edge case
  NEW     system/technical/ws-protocol.md  — documents REGISTER handshake race condition fix

Research digest: <N> findings from <N> sources walked.

Review changes in the diff viewer (Latest Changes mode), then commit or revert.
```

Each line includes: disposition (NEW / EDIT), relative path, one-line rationale, and the supporting memory path if applicable.
