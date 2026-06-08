# Init Mode

Runs when the workspace's `system/` tree is empty or sparse. Performs codebase discovery to bootstrap the initial set of prose and technical docs.

## Work-List Step (Step 2 of shared engine)

### Check Existing System Docs

Use **Glob** against `{systemDir}/**/*.md` to enumerate any existing docs, then:

```
search({ workspaceId, query: 'overview architecture', collection: 'system', limit: 10 })
```

If `search` returns an error (e.g. the index has never been built), treat it as "no existing docs found" and proceed — the Glob enumeration is authoritative.

Write in place: if a planned output path already exists (including the server-seeded placeholder `overview.md` that `init.ts` writes on workspace creation), overwrite it (`UPDATED`). If it does not exist, create it (`NEW`). No confirmation prompt needed before writing.

### Discover Codebase Structure

For each absolute repo path in `workspace.repos[]`:

- **Glob** for top-level directories and key entry points (e.g., `*/package.json`, `**/server.ts`, `**/main.ts`, `**/app/layout.tsx`, `**/index.ts`).
- **Read** the root manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, or equivalent) to identify the technology stack.
- **Grep** for routing or feature-area markers (e.g., `router\.|app\.use|@Controller|export.*Route`) to spot major clusters.
- **Read** a small set of high-signal entry-point files (one or two per repo) to confirm architecture.

Focus on breadth over depth — a structural map, not line-by-line analysis.

### Build Work-List

Draft the following files. Aim for **2–4 technical docs** at this stage (feature docs are handled by `engy:feature-docs`):

- **`system/overview.md`** — what the workspace does, repository/package structure, technology stack, how the pieces connect.
- **`system/technical/<topic>.md`** — one per major architectural concern (e.g., `data-storage.md`, `websocket-protocol.md`, `api-surface.md`): what the concern is, how the codebase handles it, key patterns and constraints.

If a planned item would be a feature doc (`system/features/<area>.md`), remove it from this mode's work-list and emit the handoff to `engy:feature-docs` per the shared engine rules.

Return the work-list to the shared engine for Steps 3–6.

## Summary Format

```
System docs init complete.

Files written:
  NEW      system/overview.md                — workspace overview, stack, structure
  NEW      system/technical/data-storage.md  — SQLite schema and Drizzle access layer  (order: 1)
  UPDATED  system/technical/ws-protocol.md   — WebSocket REGISTER handshake  (order: 2)
  ...

READMEs generated/updated:
  system/README.md
  system/technical/README.md

Research digest: <N> findings from <N> sources walked.   (or: No prior knowledge found.)

Review changes in the diff viewer (Latest Changes mode), then commit or revert.
Next step: refine individual docs with /engy:write-sysdocs (interactive mode).
```
