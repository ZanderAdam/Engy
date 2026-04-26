---
title: Knowledge Layer
status: planned
---

# Plan: M7 Knowledge Layer

## Overview

M7 delivers the knowledge persistence layer — the system that makes Engy learn from every project. It encompasses the Docs tab (system docs + shared docs), the Memory tab (fleeting → permanent memory lifecycle with browser/editor), qmd-powered hybrid search (BM25 + vector + LLM reranking), source ingestion (URLs, transcripts, files, raw text — flowing through the `engy:ingest` skill into immutable snapshots or durable references plus a distillation note), project completion flow (memory distillation + system doc proposals + archival), and memory-aware planning (the `/engy:plan` and `/engy:milestone-plan` skills dispatch the reusable **`engy:research` subagent** to surface relevant prior knowledge and bake it directly into plan documents). A thin `/engy:research` skill wraps the subagent for ad-hoc terminal use.

The key architectural decision is using `@tobilu/qmd` as the search SDK. qmd runs entirely in-process via node-llama-cpp with local GGUF models — no external service, no ChromaDB sidecar. It indexes markdown files natively, provides hybrid search out of the box, and stores its index in SQLite (rebuildable from source files at any time).

Boundary: no multi-hop research exploration, no memory linking graph UI, no automatic background cleanup scheduler, no cross-workspace search, no ad-hoc contradiction-flagging skill outside the ingestion path (contradiction surfacing happens during `engy:ingest`, not as a standalone always-on Interlocutor).

Scope model: permanent memories are workspace-scoped only — no project or repo scope enum. The `repo` field is optional provenance metadata, available as a user/agent filter but not an automatic retrieval gate. Fleeting memories are also workspace-scoped (no `projectId`); they accumulate as a single workspace-wide pile. Memories are promoted whenever a learning solidifies (not at project close); project completion just batches a review of accumulated fleeting memories via `/engy:review-memories`. Retrieval relevance is governed by qmd's hybrid ranking using project/milestone/repo context in the query, not by scope filters. Project archival deletes agent sessions and execution logs but preserves fleeting memories — they're cheap, workspace-level, and the user reviews them on their own cadence.

## Memory Layout

The three-planes model maps onto the workspace dir as follows:

```
{workspaceDir}/
  system/                  Plane 1 — prescriptive truth (current-state spec)
    README.md              hierarchical TOC
    overview.md
    features/
    technical/
  docs/                    Shared docs (conventions, guides)
    README.md
  projects/                Project specs, plans, milestones, vision, context
    README.md
  memory/                  Plane 2 — descriptive thinking (Zettelkasten)
    README.md              hierarchical TOC
    decisions/             permanent notes — choices with rationale
    patterns/              permanent notes — recurring solutions
    facts/                 permanent notes — verified information
    conventions/           permanent notes — agreed practices
    insights/              permanent notes — observations and learnings
    sources/               immutable snapshots of non-durable content (Slack threads, transcripts, articles, PDFs, photos) with provenance frontmatter
    references/            durable external link records (stable internal docs, repo paths with SHA, versioned RFCs)
```

Plane 3 — code — lives in user repos at user-specified paths, not under `workspaceDir`; it's reached via the existing client daemon and is not qmd-indexed by M7.

Permanent notes link back via `sources: []` frontmatter to the source records that triggered them. Cross-plane links use `scenarioIds: []` to anchor against system docs and tests.

**Git is the log.** Memory operations (ingest, promote, supersede, auto-link, edit) emit structured commit messages with a `memory(<op>):` prefix and a body of `key: value` lines. `git log --grep='^memory(ingest):'` and similar are the canonical query mechanism — no separate `log.md` file. Commit message convention is specified in FR-TG1.8.

## Task Group Sequencing

```text
TG1 ──────────┬──→ TG2 (depends on TG1 memory router)
              │
              └──→ TG3 (independent, can parallel with TG2)
                        │
TG1 + TG3 ────────────→ TG4 (depends on both)
```

* **TG1: Memory Data Layer** — no dependencies. Foundation for everything else. Can start immediately.

* **TG2: Knowledge UI** — depends on TG1 (memory tRPC router for data fetching).

* **TG3: qmd Hybrid Search** — depends on TG1 (needs permanent memories for indexing). Can run in parallel with TG2.

* **TG4: Completion Flow & Agent Integration** — depends on TG1 (memory data layer) and TG3 (qmd search for deduplication in distillation).

## TG1: Memory Data Layer

The foundational data layer for permanent memories. Evolves the schema, creates the memory tRPC router for the UI, and expands MCP tools for agents. Everything else in M7 depends on this.

### Requirements

1. The system shall store permanent memories with full metadata: id, type, subtype (decision/pattern/fact/convention/insight), title, repo (optional provenance metadata), confidence, source, keywords (low-level retrieval terms), themes (high-level conceptual terms), tags, linkedMemories, `scenarioIds` (array of FR/scenario IDs the memory anchors against — bridges Zettelkasten ↔ system docs ↔ tests), `sources` (array of paths to source records under `memory/sources/` or `memory/references/` that triggered this note — provenance trail), `supersededBy` (nullable FK to newer memory), and timestamps — as both SQLite records and markdown files with YAML frontmatter. Files organized Zettelkasten-style: `{workspaceDir}/memory/{subtype}/{YYYYMMDDHHmm}-{slug}.md` (e.g., `memory/decisions/202603231430-jwt-rotation-pattern.md`). Subdirectories by subtype: `decisions/`, `patterns/`, `facts/`, `conventions/`, `insights/`. *(source: FR-7.17, v1 REQ-FORMAT-001, three-planes scenario-ID bridge)* (FR-TG1.1)

2. All permanent memories are workspace-scoped — no project or repo scope enum. The `repo` field is optional provenance metadata (the codebase a memory originated from or primarily concerns) and remains available as an explicit user/agent filter, but is not an automatic retrieval gate. Cross-repo relevance is determined by qmd's hybrid ranking over the memory content and the query's project/repo context. Fleeting memories are likewise workspace-scoped only (no `projectId` field). *(source: FR-7.16, simplified)* (FR-TG1.2)

3. The system shall support memory promotion: validate fleeting memory, create permanent memory record + markdown file, mark fleeting as promoted. *(source: FR-7.5)* (FR-TG1.3)

4. The system shall provide memory CRUD via tRPC (UI) and MCP (agents), with list/filter by type, subtype, repo, tags, and text search. *(source: FR-7.3, FR-7.4)* (FR-TG1.4)

5. The system shall surface recent unpromoted fleeting memories as periodic review candidates. *(source: FR-7.6)* (FR-TG1.5)

6. The system shall support manual memory creation and editing, both via UI (tRPC) and agents (MCP). *(source: FR-7.4)* (FR-TG1.6)

7. The `updateTask` MCP tool shall accept an optional `memories` array so agents can pass learnings captured during task implementation. *(source: user request)* (FR-TG1.7)

8. Memory file operations shall be committed to git with **structured commit messages** that double as the operations log (no separate `log.md` file). Format:

   ```
   memory(<op>): <one-line summary>

   <key>: <value>
   <key>: <value>
   ```

   `<op>` is one of: `ingest`, `promote`, `supersede`, `autolink`, `edit`, `delete`. Body fields depend on op (always include relevant ones): `source_path`, `memory_id`, `subtype`, `repo`, `linked: [<ids>]`, `superseded: <id>`, `candidate_edits: <n>`, `contradictions: <n>`. Conventional Commits-compatible.

   Examples:
   ```
   memory(ingest): payment-failures-runbook reference

   source_path: memory/references/payment-failures-runbook.md
   distillation_id: 127
   candidate_edits: 2
   contradictions: 1
   ```
   ```
   memory(promote): jwt-rotation pattern

   memory_id: 412
   subtype: pattern
   repo: api-server
   linked: [202602...,202604...]
   ```

   `git log --grep='^memory(ingest):' --pretty` is the canonical "what was ingested" query. `engy:validate` greps for malformed memory commits as part of its lint pass. *(source: v1 REQ-GIT-001–007, extended with operations-log-as-git-history)* (FR-TG1.8)

9. **qmd is responsible for index freshness.** qmd's `store.update()` reads each file, computes a SHA-256 content hash, and skips files whose hash matches the existing index entry — naturally idempotent and cheap when nothing has changed. `store.embed()` skips already-embedded hashes. On a fresh checkout, the empty `.qmd/qmd.db` is auto-created on first access; the first `update()` indexes everything from source. The system does not track its own per-file mtime/checksum or per-collection git SHA — qmd handles it. The indexer's job reduces to: walk the four collection paths, call `store.update()` and `store.embed()` for each, propagate qmd's returned counts (`indexed`, `updated`, `unchanged`, `needsEmbedding`) for status display. *(source: v1 REQ-STORE-006–007, redesigned around qmd's built-in freshness)* (FR-TG1.9)

10. The system shall provision the ingestion-friendly directory structure on workspace initialization: `memory/sources/` (immutable snapshots with provenance frontmatter — URL, source type, ingester, title) and `memory/references/` (durable external link records — URL, type, title, description). Source and reference files are plain markdown with frontmatter, indexed by qmd via the existing `memory` collection. **Path convention** for the `sources[]` frontmatter array on permanent and fleeting memories: paths are stored relative to `workspaceDir` with forward slashes regardless of OS (e.g., `memory/sources/202604251030-slack-auth-thread.md`), no leading slash. The operations log is git history (FR-TG1.8); there is no `log.md` file. *(source: three-planes ingestion contract, simplified)* (FR-TG1.10)

11. The system shall maintain a `README.md` in each collection root (`system/`, `docs/`, `projects/`, `memory/`) and in each memory subtype directory (`memory/decisions/`, `memory/patterns/`, `memory/facts/`, `memory/conventions/`, `memory/insights/`, `memory/sources/`, `memory/references/`). Each README is a **hierarchical table of contents for humans**, rendering as a GitHub wiki page when the workspace is browsed. Two things every README contains:

    1. **Human-readable prose** at the top — a description of what the directory holds and how to think about it. Hand-writable; the system never overwrites prose outside the index markers.

    2. **A generated index section** between `<!-- INDEX START -->` and `<!-- INDEX END -->` markers, listing:
       - **For collection roots** (`memory/README.md`, `system/README.md`, etc.) — one bullet per immediate subdirectory, linking to that subdirectory's `README.md`, with the subdirectory's description (extracted from its README's first prose paragraph) and a count of items. Example for `memory/README.md`: `- [Decisions](decisions/) — choices made with rationale (12 notes)`.
       - **For leaf dirs** (`memory/decisions/README.md`, `memory/sources/README.md`, etc.) — one bullet per file in the directory, linking to it, with the file's frontmatter `title` (or first H1, or first prose line) as the summary. Source/reference dirs link to the snapshot/reference records with their `source_type` and date.
       - **For mixed dirs** that have both files and subdirs, both lists with subheadings.

    Frontmatter on every README is minimal: just a hand-writable `description` field used by parent READMEs to describe this collection in their TOC bullets. No index-state tracking — qmd owns freshness (FR-TG1.9). File counts are rendered into the TOC body, not stored as frontmatter.

    README updates are committed alongside the file changes that triggered them, using the appropriate `memory(<op>):` commit message (FR-TG1.8). *(source: user request — hierarchical wiki TOC)* (FR-TG1.11)

12. The system shall maintain a `frontmatter` SQLite table indexing the YAML frontmatter of every markdown file across all four collections (`system/`, `docs/`, `projects/`, `memory/`). qmd handles full-text and semantic search; the `frontmatter` table is the **structured-query and graph-traversal surface** — answers questions like "all memories tagged `auth`," "all permanent notes derived from `memory/sources/X.md`," "all files anchored to scenario ID `FR-3.4`," and reverse-link queries like "all files that link TO memory id 42." Schema:

    ```sql
    CREATE TABLE frontmatter (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      collection   TEXT NOT NULL,           -- 'system' | 'docs' | 'projects' | 'memory'
      path         TEXT NOT NULL,           -- workspace-relative, forward slashes
      data         TEXT NOT NULL,           -- canonical JSON of the parsed frontmatter
      indexed_at   TEXT NOT NULL,           -- ISO timestamp
      PRIMARY KEY (workspace_id, path)
    );
    CREATE INDEX idx_frontmatter_collection ON frontmatter(workspace_id, collection);
    ```

    Queries use SQLite JSON1 ops on the `data` column: `json_each(data, '$.tags')` for array-membership, `json_extract(data, '$.repo')` for scalar fields. Populated by the indexer (TG3-T2) for every file qmd reports as `updated` or `indexed`; rows removed when qmd reports a file as `removed`. The unified `search` MCP tool's structured-filter path (FR-TG3.6) queries this table. The `engy:research` subagent (FR-TG4.11) uses it for graph walks (forward links via `linkedMemories`, backward links via reverse JSON queries, source provenance via `sources`, scenario anchors via `scenarioIds`). *(source: user request — frontmatter-as-graph)* (FR-TG1.12)

### Tasks

1. **Schema evolution, memory file utilities & ingestion dirs**

   * Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/XXXX_permanent_memories.sql` [NEW], `web/src/server/lib/memory-files.ts` [NEW], `web/src/server/engy-dir/init.ts` [MODIFY]

   * Implements FR-TG1.1, FR-TG1.2, FR-TG1.8, FR-TG1.9, FR-TG1.10, FR-TG1.11, FR-TG1.12

   * Add `permanentMemories` table with FR-7.17 fields (excluding `scope` — not used) plus `supersededBy` (nullable self-FK), `keywords` (JSON array — low-level retrieval terms), `themes` (JSON array — high-level conceptual terms), `repo` (nullable text — provenance metadata, not a retrieval gate), `scenarioIds` (JSON array of FR/scenario ID strings — cross-plane bridge), and `sources` (JSON array of paths under `memory/sources/` or `memory/references/`). Add `promotedFromId` and `promotedAt` to `fleetingMemories` for promotion tracking; add `sources` (JSON array) so fleeting distillations from ingestion carry the source pointer. **Add `frontmatter` table** per FR-TG1.12 (universal frontmatter index for all four collections, JSON1-queryable). **Drop `projectId` column from `fleetingMemories`** — fleetings are workspace-scoped only; existing `source` column carries originating context. Drop the unused `projectMemories` table in the same migration. Create `memory-files.ts` utility:

     * `writePermanentMemory(...)` → `{workspaceDir}/memory/{subtype}/{YYYYMMDDHHmm}-{slug}.md`
     * `writeSourceSnapshot(...)` → `memory/sources/{YYYYMMDDHHmm}-{slug}.md` (frontmatter: url, source_type, ingester, title; body: snapshot content; the timestamp ID in the filename plus git commit time cover "when," qmd's content hash covers "what")
     * `writeReferenceRecord(...)` → `memory/references/{slug}.md` (frontmatter only: url, type, title, description)
     * Read any of these back to structured data, parse frontmatter via `gray-matter` (the de-facto YAML-frontmatter parser in the JS ecosystem); reject malformed frontmatter (missing `---` delimiters, invalid YAML, `tags`/`scenarioIds`/`sources`/`linkedMemories` not arrays) with a clear error rather than partial parse.
     * **Path validation** for every `sources[]` entry written or read: must be a relative path, must contain no `..` segments, must resolve under `workspaceDir/memory/sources/` or `workspaceDir/memory/references/` after normalization. Reject anything else. Same validation for `linkedMemories[]` (must reference `memory/{subtype}/...md`).
     * **INDEX marker escaping** in any user-supplied content written into `memory/`: when writing a snapshot body that contains literal `<!-- INDEX START -->` or `<!-- INDEX END -->` markers, escape them by zero-width-joining or wrapping in code fences, so a malicious source can't corrupt parent README regeneration. The README maintenance utility itself only operates on README files and only between markers, but defense-in-depth on snapshot writes is cheap.
     * **Snapshot deduplication by content hash**: before `writeSourceSnapshot()` writes a new file, compute the SHA-256 of the snapshot body and check for an existing source with the same hash (cheap query against the `frontmatter` table or via reading `memory/sources/`). If found, return the existing source path instead of creating a duplicate; the caller (`engy:ingest`) reuses it for the new fleeting distillation. Same URL ingested twice → one snapshot, two distillations linked to it.
     * **Server-side git ops** on the workspace dir (e.g., `simple-git` rooted at `workspaceDir` — workspace dir is in `ENGY_DIR`, not a user repo, daemon not involved) with **structured `memory(<op>):` commit messages per FR-TG1.8**.

   After every memory/source/reference write or delete, call `regenerateReadmeChain(filePath)` (below) so the README chain ships in the same commit as the underlying change.

   **README maintenance utilities:**

  - `updateReadmeIndex(dirPath)` — rewrites the `<!-- INDEX START -->` / `<!-- INDEX END -->` block. For dirs containing subdirectories, emits one bullet per subdir (linking to `<subdir>/README.md` with the subdir README's `description` frontmatter, plus the subdir's file count rendered into the bullet text); for dirs containing files, emits one bullet per file (linking to it with `title` frontmatter / first H1 / first prose line as summary); for mixed dirs, emits both lists under "Sections" and "Notes" subheadings. Always preserves prose outside the markers.
    - **Bullet ordering**: alphabetical by filename (deterministic, diff-friendly).
    - **Empty subdirs**: rendered with `(empty)` placeholder bullet so the parent's TOC reflects the empty state rather than silently omitting it.
    - **Missing description**: fall back to first H1 in the file, then first non-empty prose line, then the filename stem; never fail.
    - **Link paths**: relative, with trailing slash for directories (`decisions/`) and explicit filename for files (`202604...-foo.md`).
    - **Markdown escaping in TOC entries**: titles passed through a small escaper that backslash-escapes `]`, `)`, and the literal strings `<!-- INDEX START -->` / `<!-- INDEX END -->` to prevent malformed link syntax or marker re-injection.
    - **Nesting**: M7 only supports one level of subdirs under each collection root; deeper nesting is not regenerated automatically (rendered as a flat bullet linking to the deepest dir's README only).

  - `regenerateReadmeChain(filePath)` — when a memory file changes, walks up the dir chain (`memory/decisions/` → `memory/`) calling `updateReadmeIndex` at each level so the TOC stays current.

   **Init**: ensure subtype directories (`decisions/`, `patterns/`, `facts/`, `conventions/`, `insights/`) and ingestion dirs (`sources/`, `references/`) are created on workspace init (`engy-dir/init.ts:44-68`). Seed a starter README in each collection root and subtype dir — one-paragraph human description, empty `<!-- INDEX START --> <!-- INDEX END -->` markers, frontmatter `description: <one-line>`. The existing `system/overview.md` remains; `system/README.md` is a separate machine-managed index file. **No `log.md` seeded** — git history is the operations log (FR-TG1.8).

   **Backfill for existing pre-M7 workspaces** (workspaces created in earlier milestones): expose `backfillM7(workspaceSlug)` — checks each expected directory and README; creates anything missing using the same logic as fresh init; then runs `WorkspaceIndexer.update()` (TG3-T2) once to populate qmd and the `frontmatter` table from existing files; commits the structural additions as `memory(init): backfill M7 directories`. Invoked automatically on first server start that detects an M7-incompatible workspace (presence of `memory/` but absence of `memory/README.md`); also exposed as a one-shot via the `reindex` MCP tool with `full: true`.

   Generate Drizzle migration. **SQLite migration note:** dropping `projectId` from `fleetingMemories` and dropping the `projectMemories` table require Drizzle Kit's table-recreate migration (SQLite doesn't support `DROP COLUMN` cleanly across versions). **Existing data fate:** `fleetingMemories.projectId` values are discarded during the table-recreate (workspace-scoping is the new model; project provenance was never load-bearing for retrieval). `projectMemories` rows are dropped wholesale — the table was unused.

   **Caller audit (mandatory):** before merging the migration, grep the repo for `projectId` references on fleeting memories and for any usage of the `projectMemories` table — across `web/src/server/`, `web/src/app/`, `web/src/components/`, `client/src/`, and all `*.test.ts` files — and update each site to the workspace-scoped model. Forgotten callers throw at runtime.

2. **Memory tRPC router** (depends on task 1)

   * Files: `web/src/server/trpc/routers/memory.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]

   * Implements FR-TG1.3, FR-TG1.4, FR-TG1.5, FR-TG1.6

   * Endpoints: `create` (permanent memory → DB + file), `update` (DB + file sync), `delete` (DB + file), `get` (by id), `list` (filter by type/subtype/repo/tags, text search, pagination), `promote` (fleeting → permanent: validate, create permanent, write file, mark fleeting promoted), `reviewCandidates` (recent unpromoted fleeting memories sorted by age). Follow existing router patterns (workspace slug resolution, input validation with zod).

3. **MCP memory tools expansion & updateTask memories** (depends on task 1)

   * Files: `web/src/server/mcp/index.ts` [MODIFY]

   * Implements FR-TG1.4, FR-TG1.6, FR-TG1.7

   * Add tools: `createPermanentMemory` (full metadata), `updatePermanentMemory`, `promoteMemory` (fleeting → permanent). **Remove `projectId` parameter from existing `createFleetingMemory`** (currently `web/src/server/mcp/index.ts:603-615`) — schema is now workspace-only; agents pass `workspaceId`, `content`, `type`, `source`, `tags`. **Remove `projectId` filter from existing `listMemories`** (`mcp/index.ts:626-630`) — keep `workspaceId` and `compact`. Mark `listMemories` as scheduled for replacement by the unified `search` tool in TG3-T5, but keep it fully functional in TG1 — agents may rely on it during the gap between TG1 and TG3-T5 landing. Remove `listMemories` only after `search` is live. Extend `updateTask` tool to accept optional `memories: { content: string, type?: string }[]` — when provided, creates fleeting memories scoped to the task's workspace (no `projectId`; `source` is set to `agent`). Follow existing MCP tool patterns (zod schemas, JSON text responses).

**Parallelizable:** Tasks 2 and 3 have no file conflicts and can run concurrently after task 1 completes.

### Completion Summary

{Updated after TG completes}

## TG2: Knowledge UI (Docs + Memory Tabs)

Builds the workspace UI for browsing docs and memories. Enhances the existing Docs tab with system/docs tree separation and builds the Memory tab from scratch with browser + detail layout, filters, CRUD, and promotion flow.

### Requirements

1. The system shall display the Docs tab with tree + editor layout, separating `system/` (features/, technical/) and `docs/` (shared conventions, guides) with section headers. *(source: FR-7.1)* (FR-TG2.1)

2. The system shall support inline comments on documents using the existing BlockNote thread system. *(source: FR-7.2)* (FR-TG2.2)

3. The system shall provide a Memory tab with browser (left panel: list with filter by type, repo, tags + search) and detail view (right panel: content editor, metadata display). The "scope" filter implied by spec FR-7.3 is deliberately dropped — all permanent memories are workspace-scoped (see FR-TG1.2). *(source: FR-7.3, simplified)* (FR-TG2.3)

4. The system shall support manual memory creation via a create form and editing via the detail view content editor. *(source: FR-7.4)* (FR-TG2.4)

5. The system shall provide a promotion flow: select fleeting memory → promote dialog (choose type/subtype, add title, confirm) → creates permanent memory. *(source: FR-7.5)* (FR-TG2.5)

6. The system shall surface periodic review candidates (recent unpromoted fleeting memories) as a dedicated "Review Candidates" tab within the Memory page browser, with a count badge on the tab label showing the unpromoted count. *(source: FR-7.6, pinned from "section or badge")* (FR-TG2.6)

7. The promotion flow shall check for duplicate/similar existing permanent memories via the search API (when available) and surface them to the user — options: skip, supersede existing, or promote anyway. *(source: user request — v1 feature brought back)* (FR-TG2.7)

### Tasks

1. **Docs tab enhancement**

   * Files: `web/src/app/w/[workspace]/docs/page.tsx` [MODIFY]

   * Implements FR-TG2.1, FR-TG2.2

   * Add collapsible section headers ("System Docs" / "Shared Docs") to the `WorkspaceTree` using the existing `TreeView` accordion pattern, filtering to show only `system/` and `docs/` subtrees (exclude `projects/`, `memory/`, and `workspace.yaml`). Verify inline comments work (already using `EngyThreadStore` + BlockNote `CommentsExtension` — should work out of the box). Add "New Document" action in top-right that scopes to the selected section.

2. **Memory tab: browser panel + list** (depends on TG1-T2)

   * Files: `web/src/app/w/[workspace]/memory/page.tsx` [MODIFY], `web/src/components/memory/memory-browser.tsx` [NEW], `web/src/components/memory/memory-filters.tsx` [NEW]

   * Implements FR-TG2.3, FR-TG2.6

   * Replace `EmptyTab` with two-panel layout (reuse `ThreePanelLayout` pattern from docs page). Left panel: tabbed browser with two tabs — "Permanent" (default) and "Review Candidates" (unpromoted fleetings, count badge on the tab label using `memory.reviewCandidates` count). Both tabs share filter dropdowns (type, subtype, repo), tag chips, and search input. The `repo` dropdown is populated from `workspaces.repos` (existing JSON column) — do not invent a separate repo list. Sort by date/confidence. Memory items show: title/content preview, type badge, repo badge (if set), confidence, date.

3. **Memory tab: detail view, CRUD & promotion** (depends on task 2)

   * Files: `web/src/components/memory/memory-detail.tsx` [NEW], `web/src/components/memory/memory-form.tsx` [NEW], `web/src/components/memory/promote-dialog.tsx` [NEW]

   * Implements FR-TG2.4, FR-TG2.5, FR-TG2.7

   * Right panel: selected memory detail with BlockNote content editor (editable) — inline comment threads enabled via the existing `EngyThreadStore` keyed by the memory file path (FR-7.2 covers documents broadly; permanent memories qualify). Metadata display (type, subtype, repo, confidence, source, tags, linked memories, timestamps). Create form for new permanent memories (title, content, type/subtype, repo, tags). Promote dialog: triggered from review candidates list, select type/subtype, add title, confirm → calls `memory.promote` mutation. Duplicate check: before promoting, call `search.query` with the memory content — if similar permanent memories found (score > threshold), show them in the dialog with options: skip (don't promote), supersede (promote + mark existing as superseded), or promote anyway. Gracefully degrades if search API is not yet available (TG3 not complete).

**Parallelizable:** Task 1 (docs) has no dependencies and can run in parallel with tasks 2–3. Tasks 2 and 3 are sequential (detail builds on browser layout).

### Completion Summary

{Updated after TG completes}

## Testing

The project's CLAUDE.md mandates trophy-style BDD testing with colocated `*.test.ts` files and no DB mocks. Per-task minimum integration coverage:

* **TG1-T1**: `memory-files.test.ts` — write/read roundtrip for permanent / source / reference; frontmatter parsing rejects malformed input; path validation rejects `..` and out-of-workspace paths; INDEX-marker escaping; snapshot dedup by hash; backfill on a synthetic pre-M7 workspace.
* **TG1-T2**: `memory.test.ts` — CRUD via tRPC; `promote` writes file + DB row + commit; `reviewCandidates` returns only unpromoted fleetings.
* **TG1-T3**: extend `mcp/index.test.ts` — new memory tools, `updateTask` memories array passthrough.
* **TG3-T2**: `indexer.test.ts` — qmd update + frontmatter table sync; idempotent re-runs on unchanged files; deleted file removes frontmatter row; backfill end-to-end.
* **TG3-T3**: `search.test.ts` — three call modes (query, filters, both); JSON1 filter correctness; cross-collection grouping.
* **TG3-T5**: `auto-linker.test.ts` — bidirectional links; `max_links` cap; threshold gating; recursion bound (auto-link doesn't re-fire from indexer).
* **TG3-T6**: `validate.test.ts` — broken-link detection, schema-compliance lint, commit-message lint, `needsEmbedding > 0` reporting.
* **TG4-T1**: `project-completion.test.ts` — distillation surfaces only unpromoted workspace fleetings; archival deletes sessions/logs and preserves plan/tasks/memories.
* **TG4-T3**: `agent-spawner.test.ts` extension — `CREATE_MEMORIES_REQUEST` roundtrip; runner persists fleetings on completion-output memories.
* **TG4-T7**: `ingest-skill` integration — full ingest of a fixture URL produces source record + fleeting + dispatched research; idempotent on repeat ingest.

Unit tests fill gaps (e.g., README rendering edge cases, frontmatter parser corner cases). Coverage thresholds inherited from package CLAUDE.md files.

## Concurrency

M7 does not introduce locks, queues, or cross-skill mutexes. Concurrent skill runs (e.g., `/engy:ingest` while a project is completing, or two `/engy:review-memories` sessions) are **allowed** and assumed rare. Skills that write memory files must include a "courtesy check" in their prompt: before each commit, run `git status --short` on the workspace dir and surface any uncommitted changes from another in-flight skill to the user — letting them decide whether to pause, abort, or proceed. This is best-effort coordination, not enforcement.

The `frontmatter` SQLite table is concurrency-safe by virtue of SQLite's serialization. qmd's `store.update()` is content-hash-keyed and tolerates re-runs. The exposed footgun is the README chain regeneration: two writes that both walk up to `memory/README.md` can interleave the regenerated `<!-- INDEX -->` block. Skills should commit the README chain in the same commit as the underlying file change so the post-write `git status` check catches divergence quickly.

## TG3: qmd Hybrid Search

**Architectural note — indexing is code, not agent.** The indexing pipeline (call qmd's `store.update()` + `store.embed()` → mirror parsed frontmatter into the `frontmatter` SQLite table → for the memory collection, also sync the `permanentMemories` mirror) is mechanical, deterministic work and lives entirely in `WorkspaceIndexer` server code. qmd's content-hash-based freshness means the pipeline is naturally idempotent — calling it repeatedly is cheap. Agents and skills do not orchestrate it step-by-step; they invoke it through a single MCP tool (`reindex` with optional `collection` arg, returning structured qmd counts). The `engy:reindex` skill is a one-line wrapper. Same for incremental updates — invoked by `dir.write`/`dir.delete` mutations or by the `engy:ingest` skill via the MCP tool, never reconstructed by an agent. Skill-level intelligence applies to the *decisions* (when to reindex, how to interpret needsEmbedding counts in `engy:validate`), not to the pipeline mechanics.

**Architectural note — git ops are server-side.** All git operations on the workspace dir (commit, diff, rev-parse) happen on the server using a local git library (e.g., `simple-git`) or shelled-out `git` rooted at `workspaceDir`. The workspace dir is in `ENGY_DIR`, server-managed; the client daemon is **not** involved (the daemon's git surface is for user repos, which are at user-specified paths and not indexed by qmd).

Integrates `@tobilu/qmd` for hybrid search across all workspace content. Sets up the qmd store with collections, builds an indexing pipeline triggered by file changes, exposes search via tRPC, and adds reindex/validate terminal skills.

### Requirements

1. The system shall integrate qmd (`@tobilu/qmd`) to index all workspace content as collections with path-specific context: `system` (system docs), `docs` (shared docs), `projects` (specs, plans, milestones, vision, context — everything under `projects/`), `memory` (permanent memories). Tasks remain in SQLite and are queried separately. *(source: FR-7.7)* (FR-TG3.1)

2. The system shall provide a search API using qmd hybrid search (BM25 + vector + LLM reranking) combined with SQLite structured queries, with results grouped by collection (system, docs, projects, memory, tasks). *(source: FR-7.8)* (FR-TG3.2)

3. The system shall provide `engy reindex` to rebuild the qmd store (`store.update()` + `store.embed()`) and `engy validate` for broken links, schema compliance, duplicate IDs, orphaned content, and lifecycle consistency. *(source: FR-7.9)* (FR-TG3.3)

4. The system shall support `engy validate` and `engy reindex` as terminal skills — not just CLI commands. *(source: FR-7.18)* (FR-TG3.4)

5. The system shall provide a global search bar on every page with results grouped by type. *(source: inferred from UI design context — header search)* (FR-TG3.5)

6. The system shall expose a unified `search` MCP tool that searches across all content types (system docs, shared docs, project files, memories, tasks). Accepts optional `query` (semantic search via qmd), optional `collection` filter (system/docs/projects/memory/tasks), and optional structured `filters` (type, subtype, repo, tags, promoted — for memories; status — for tasks). When only filters are provided without a query, falls back to SQLite structured query. Replaces `listMemories` and `listPermanentMemories`. *(source: user request — single search surface for agents)* (FR-TG3.6)

7. When a permanent memory is created or promoted, the system shall use qmd search to find related existing memories and establish bidirectional links (type: `relates_to`, `derived_from`, etc.) in both memory files' frontmatter. Link candidates above a similarity threshold are written automatically; the `/engy:review-memories` skill can refine link types. *(source: v1 REQ-LINK-001–004)* (FR-TG3.7)

### Tasks

1. **qmd store setup & collection configuration**

   * Files: `web/package.json` [MODIFY], `web/src/server/search/qmd-store.ts` [NEW]

   * Implements FR-TG3.1

   * Install `@tobilu/qmd`. Create `QmdStoreManager` singleton: lazy-initializes one qmd store per workspace. Store database at `{ENGY_DIR}/{workspace-slug}/.qmd/qmd.db`. Configure collections matching the actual workspace layout (no top-level `specs/` directory exists): `system` (path: `system/`, pattern: `**/*.md`), `docs` (path: `docs/`, pattern: `**/*.md`), `projects` (path: `projects/`, pattern: `**/*.md` — covers each project's `spec.md`, `context/`, `plans/`, `milestones/`, and `*.vision.md` files), `memory` (path: `memory/`, pattern: `**/*.md`). Add collection-level context describing each content type for relevance tuning (e.g., the `projects` collection context notes that documents include specs, vision docs, plans, and milestones). Export `getStore(workspaceSlug)` accessor.

2. **Indexing pipeline** (depends on task 1)

   * Files: `web/src/server/search/indexer.ts` [NEW], `web/src/server/trpc/routers/dir.ts` [MODIFY]

   * Implements FR-TG3.1, FR-TG1.9, FR-TG1.12

   * Create `WorkspaceIndexer` — a thin orchestrator that delegates freshness to qmd and updates the frontmatter index alongside:

     * `update(workspaceSlug, collection?)` — for each target collection (default: all four), calls `store.update()` then `store.embed()` and captures qmd's returned counts (`indexed`, `updated`, `unchanged`, `removed`, `needsEmbedding`). For each file qmd reports as `indexed` or `updated`, parse its frontmatter and `INSERT OR REPLACE` into the `frontmatter` SQLite table. For each file qmd reports as `removed`, `DELETE` its row from the frontmatter table. Returns aggregate counts per collection. Idempotent and cheap when nothing has changed (qmd's content hashing skips unchanged files; we only touch the frontmatter table for files qmd actually re-ingested).

     * `forceFullReindex(workspaceSlug)` — calls qmd's `removeCollection`/re-add path or `store.embed({ force: true })` for an unconditional re-embed; otherwise behaves like `update()`. For the `engy:reindex` user-invoked rebuild path.

     * `syncPermanentMemoryMirror(workspaceSlug)` — separate from qmd: scans `memory/{subtype}/*.md` files and upserts the `permanentMemories` SQLite mirror. Called as part of `update()` for the memory collection only (other collections don't have an SQLite mirror — they're file + frontmatter-table only).

     * Hook into `dir.write` and `dir.delete` tRPC mutations to call `update(collection)` **synchronously in-process after the git commit** — qmd's hash check makes the per-write cost ~O(file_size) for hashing, so blocking the mutation response is acceptable at M7's scale. No queue, no worker process. If qmd embedding lags (first-run model download or large batch), `update()` returns control after `store.update()` and the embed pass continues in a background promise — the mutation still returns quickly.

     * Initial index runs lazily on the first call to `getStore(workspaceSlug)` — i.e., the first search, reindex, or `dir.write`/`dir.delete` mutation that touches the workspace after server boot. Handle embedding progress via logging (not blocking UI).

     * **No git diff, no SHA tracking.** qmd owns freshness via content hashing; our job is just to mirror the frontmatter into a JSON1-queryable table for graph and structured-filter queries.

3. **Search tRPC router** (depends on task 2)

   * Files: `web/src/server/trpc/routers/search.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]

   * Implements FR-TG3.2, FR-TG1.12

   * Search router: `search.query({ workspaceSlug, query?, collection?, filters?, limit? })` — three call modes mirroring the MCP tool surface (TG3-T5):

     * **`query` only** → calls qmd `store.search()` (hybrid: BM25 + vector + LLM rerank) plus SQLite `LIKE` on `tasks.title/description`, returns results grouped by collection (system, docs, projects, memory, tasks) with `path`, `title`, `snippet`, `score`.

     * **`filters` only** → SQLite query against the `frontmatter` table (FR-TG1.12) using JSON1 ops: array-membership via `EXISTS (SELECT 1 FROM json_each(data, '$.<field>') WHERE value = ?)` for `tags`, `scenarioIds`, `sources`, `linkedMemories`; scalar match via `json_extract(data, '$.<field>') = ?` for `type`, `subtype`, `repo`. Multiple filters AND together. Returns the same shape (collection-grouped paths/titles, no snippet/score for pure-filter queries — caller can fetch content if needed).

     * **`query` + `filters`** → qmd hybrid first, then narrow the candidate set by joining against the `frontmatter` table on path. Filter narrows; qmd ranks.

     The router exports a single procedure with optional inputs; the global search bar (TG3-T4) uses the `query` mode, the Memory tab's cross-collection filter UI uses the `filters` mode, and `engy:research` walks the graph by composing `filters`-only calls (forward/backward link queries via `linkedMemories` JSON1 membership). Memory-tab in-collection filtering on permanent memories continues to use `memory.list` against typed `permanentMemories` columns — same data, faster path. Note: `root.ts` is also modified by TG1-T2 (memory router), but TG1 completes before TG3 starts — no conflict.

4. **Global search UI** (depends on task 3)

   * Files: `web/src/components/search/global-search.tsx` [NEW], `web/src/components/header-actions.tsx` [MODIFY]

   * Implements FR-TG3.5

   * Global search component: command palette style (Cmd+K), input debounced at **300ms** (qmd hybrid search runs in-process and includes an LLM rerank pass — debouncing keystroke-rate avoids spawning a node-llama-cpp inference per character). Cancel in-flight queries when the input changes. Calls `search.query`, grouped results with navigation on click. Wire into the existing header actions row.

5. **Unified `search` MCP tool & auto-linking** (depends on task 3)

   * Files: `web/src/server/mcp/index.ts` [MODIFY], `web/src/server/search/auto-linker.ts` [NEW]

   * Implements FR-TG3.6, FR-TG3.7

   * Unified `search` MCP tool: accepts `workspaceId`, optional `query` (semantic), optional `collection` (system/docs/projects/memory/tasks), optional `filters`. For files (any collection) the filter surface is generic over frontmatter: `tags`, `scenarioIds`, `sources`, `linkedMemories`, plus memory-specific shortcuts (`type`, `subtype`, `repo`, `promoted`); for tasks: `status`. With `query` → delegates to `search.query` tRPC (qmd hybrid search + SQLite for tasks), returns grouped results with snippets. Without `query` but with `filters` → queries the `frontmatter` table (FR-TG1.12) using SQLite JSON1: array-membership via `EXISTS (SELECT 1 FROM json_each(data, '$.tags') WHERE value = ?)`, scalar match via `json_extract(data, '$.repo') = ?`. Reverse-link queries ("what files link to memory id 42") work as JSON1 array-membership against `linkedMemories`. With both `query` and `filters` → qmd hybrid search post-filtered by the frontmatter table to narrow the candidate set. Replaces deprecated `listMemories` and planned `listPermanentMemories`. Used by `engy:research` (graph walks), `engy:ingest`, `engy:review-memories`, planning skills, and any agent that needs to find content. Note: `mcp/index.ts` is also modified by TG1-T3 (memory tools), but TG1 completes before TG3 — no conflict. `autoLink(memoryId)` function in `auto-linker.ts`: on memory creation/promotion, search qmd for related memories above a similarity threshold and below a fan-out cap, write bidirectional `relates_to` links in both files' frontmatter, commit changes. **Defaults**: `similarity_threshold: 0.75` (qmd hybrid score; tunable later), `max_links: 5` (cap on links written per autoLink invocation — prevents fan-out explosion for popular topics). **Append uses set-semantics on `linkedMemories`** — auto-link reads the existing array, unions in the new link IDs, and writes the deduplicated set back. Same memory ID is never appended twice across repeated invocations, so cumulative growth is bounded by the number of distinct related memories, not by call count. Both are constants in `auto-linker.ts` for now; M8+ may surface them in workspace settings. Auto-linker emits only `relates_to` (the safe default); refining to other v1 link types (`led_to`, `supersedes`, `contradicts`, `derived_from`, `applies_to`) is the user's job via `/engy:review-memories`. **Recursion is naturally bounded:** `autoLink()` is only invoked by the `memory.create` and `memory.promote` tRPC mutations, never by the indexer. When auto-link writes its `relates_to` links to two memory files, the next `WorkspaceIndexer.update('memory')` re-indexes those files (so the new links are searchable in qmd), but the indexer never calls `autoLink()`, so the cycle terminates at depth one regardless of fan-out.

6. **Reindex & validate terminal skills** (depends on tasks 1 and 2)

   * Files: `plugins/engy/skills/reindex/SKILL.md` [NEW], `plugins/engy/skills/validate/SKILL.md` [NEW]

   * Implements FR-TG3.3, FR-TG3.4

   * Add MCP tools: `reindex({ workspaceId, collection?, full?: boolean })` — calls `WorkspaceIndexer.update()` (or `forceFullReindex()` when `full: true`) and returns per-collection qmd counts (`indexed`, `updated`, `unchanged`, `removed`, `needsEmbedding`, `durationMs`) plus the count of frontmatter rows touched. `indexStatus({ workspaceId })` — runs a no-op `update()` (qmd's hash check is fast) and reports per-collection counts; `unchanged === fileCount` means up-to-date.

   * `engy:reindex` skill — thin wrapper: calls the `reindex` MCP tool (defaulting to incremental across all collections; `full: true` when the user explicitly requests a forced rebuild) and reports the structured results.

   * `engy:validate` skill: checks broken links between documents, schema compliance of memory frontmatter, duplicate IDs, orphaned content (files in `permanentMemories` but missing on disk, or vice versa), lifecycle consistency (promoted fleeting memories have corresponding permanent records), commit-message conformance (every commit touching `memory/` matches the `memory(<op>):` convention from FR-TG1.8), and runs `indexStatus` to confirm qmd is up-to-date (any non-zero `needsEmbedding` count is reported as "X files awaiting embedding"). Reports findings grouped by severity. Note: `reindex` skill references tools from tasks 1-2 — write after store API is established.

**Parallelizable:** Task 6 can start after task 1. Tasks 4 and 5 can run in parallel after task 3 completes. Dependency chain: T1 → T2 → T3 → {T4, T5} parallel. T6 independent after T1.

### Completion Summary

{Updated after TG completes}

## TG4: Completion Flow & Agent Integration

Closes the knowledge feedback loop. On project completion: distill memories, propose system doc updates, archive the project. Inject memory context into agent prompts. Add bootstrap and sysdoc-assistant skills.

### Requirements

1. The system shall surface unpromoted fleeting memories as promotion candidates on project completion (server-side, no agent). Since fleeting memories are workspace-scoped (no `projectId`), distillation surfaces all unpromoted fleetings workspace-wide — identical in shape to ongoing `/engy:review-memories` maintenance, with project completion just acting as a natural batch trigger. The Memory tab's "Review Candidates" section displays them; deduplication against existing permanent memories happens during the review step (qmd search), not pre-distillation. *(source: FR-7.10, simplified)* (FR-TG4.1)

2. The system shall provide a `/engy:propose-sysdocs` terminal skill that proposes system doc updates based on project context — writes proposed changes to `{workspaceDir}/system/`, reviewable via diff viewer's "Latest Changes" using the batched review model. *(source: FR-7.11)* (FR-TG4.2)

3. The system shall archive completed projects: compact (preserve plan content, milestones, groups, task structure, key decisions, final statuses), discard agent session state and execution logs. Fleeting memories are NOT deleted on archive — they're workspace-scoped, cheap, and the user manages them via `/engy:review-memories` on their own cadence. *(source: FR-7.12, simplified)* (FR-TG4.3)

4. The `/engy:plan` and `/engy:milestone-plan` skills shall dispatch the reusable `engy:research` **subagent** (FR-TG4.11) via the Task tool, passing the current project/milestone/repo context, and fold the returned digest into the plan document. Memories land in the plan document itself; the runner's `buildPromptForTask()` is unchanged. Retrieval relevance is determined by qmd's hybrid search (BM25 + vector + rerank); when the work is repo-local, the research subagent passes `filters.repo` as a structured fallback to bias retrieval — this is the load-bearing use of the `repo` provenance field at retrieval time. Subagent dispatch (Task tool) gives true context isolation: the planner's main context never sees raw search hits or link-walk traversal, only the curated digest. *(source: FR-7.13, simplified)* (FR-TG4.4)

5. The async background agent structured completion output (`--json-schema`) shall include a `memories` array for learnings captured during execution, which the runner persists as fleeting memories. *(source: user request)* (FR-TG4.5)

6. The implementation skill (`engy:implement`) shall instruct agents to pass memories via both `updateTask` and the completion output. The planning skills (`engy:plan`, `engy:milestone-plan`) shall search memories via MCP and incorporate relevant learnings into plans. *(source: user request)* (FR-TG4.6)

7. The system shall provide a bootstrap skill that reads codebase via client connection and proposes initial system docs for review. *(source: FR-7.14)* (FR-TG4.7)

8. The system shall provide an `engy:sysdoc-assistant` Claude Code skill for editing system docs. *(source: FR-7.15)* (FR-TG4.8)

9. The system shall provide an `/engy:review-memories` terminal skill that uses LLM + qmd search to review unpromoted fleeting memories: proposes type/subtype/title, suggests keywords/themes/tags, checks for duplicates and contradictions via `search`, handles supersession — user approves/rejects each candidate. Detects conflicts: supersession (same topic, newer info) and contradiction (conflicting statements). *(source: user request + v1 REQ-CONFLICT-001–006)* (FR-TG4.9)

10. The system shall enrich memories at promotion time: LLM suggests keywords (low-level retrieval terms), themes (high-level conceptual terms), tags, and a concise title if not provided, lowering the friction of manual promotion. *(source: user request + v1 REQ-CREATE-002)* (FR-TG4.10)

11. The system shall provide a reusable `engy:research` **subagent** (Task tool target) that performs multi-collection qmd `search`, walks frontmatter links (`sources` to snapshots/references, `linkedMemories` to related notes, `scenarioIds` into system docs and tests), evaluates relevance, and returns a synthesized digest with inline citations (file paths and scenario IDs). The subagent has a narrow tool whitelist (`search` MCP tool, file Read for link-walking) and isolated context. Skills requiring knowledge research (`engy:plan`, `engy:milestone-plan`, `engy:ingest`, `engy:propose-sysdocs`, `engy:bootstrap-sysdocs`, `engy:sysdoc-assistant`) dispatch the subagent via Task rather than embedding their own research loop. A thin `/engy:research` skill wraps the subagent for ad-hoc terminal invocation by the user ("what do we know about X?"). *(source: Librarian role — three-planes doc)* (FR-TG4.11)

12. The system shall provide an `engy:ingest` skill that uses a subagent to ingest external content (URLs, raw text, file paths, transcripts including Granola). The subagent: (a) classifies durability — link (durable: internal docs with stable URLs, repo paths with SHA, versioned public RFCs) vs snapshot (non-durable: Slack threads, meeting transcripts, articles, PDFs, emails, podcasts); (b) writes a reference record to `memory/references/` or an immutable snapshot to `memory/sources/` with provenance frontmatter; (c) drafts a fleeting distillation memory (core claim, what surprised, connections, contradictions) with `sources` populated; (d) dispatches `engy:research` to surface related permanent notes and contradictions with prior positions; (e) writes proposed edits to existing notes as **uncommitted working-tree changes** that the user reviews via the existing diff viewer's "Latest Changes" mode (same flow as `/engy:propose-sysdocs`, FR-TG4.2 — no separate approval UI); (f) commits each operation with the structured `memory(ingest):` commit message convention from FR-TG1.8 — git history is the operations log, no `log.md` file. Ingestion does not auto-promote — the distilled fleeting flows through the standard `/engy:review-memories` path. *(source: three-planes ingestion contract)* (FR-TG4.12)

### Execution Mechanics

The completion pipeline uses **terminal skills** (not background agents) because the user needs to review and approve at each step. The flow is:

1. User marks project as "completing" in the UI (or runs `/engy:complete-project` in terminal).

2. **Distillation** runs server-side (cheap DB query — no agent, no qmd). Surfaces all unpromoted workspace fleeting memories as promotion candidates in the Memory tab.

3. User runs `/engy:review-memories` in the terminal. The skill iterates through promotion candidates, uses LLM to propose type/subtype/title/tags for each, checks `search` for duplicates, and presents each candidate for approval. User approves (promote), rejects (discard), or supersedes (promote + mark existing as superseded). Alternatively, user can promote manually via the Memory tab UI.

4. **System doc proposals**: User runs `/engy:propose-sysdocs` skill in the terminal. The skill reads project context (completed tasks, promoted memories) and proposes system doc changes by writing files to `{workspaceDir}/system/`. Since the skill runs in the terminal (not a worktree), changes appear as uncommitted modifications visible in the diff viewer's "Latest Changes" mode. User reviews and approves via the batched review model.

5. **Archival**: User confirms archival via UI action. Server compacts the project (deletes agent sessions + execution logs; preserves plan, tasks, permanents, and fleetings).

**Ongoing memory maintenance** (not tied to project completion): User can run `/engy:review-memories` at any time to review accumulated fleeting memories. This replaces v1's cleanup scheduler with an on-demand skill.

For **memory-aware planning**: memories flow through **planning**, not execution. The `/engy:milestone-plan` and `/engy:plan` skills dispatch the reusable **`engy:research` subagent** via the Task tool, passing the milestone/task description (and `filters.repo` when repo-local) as context. The subagent calls the unified `search` MCP tool, walks frontmatter links across the four indexed collections (system, docs, projects, memory), and returns a curated digest with citations. The planner folds the digest directly into the plan document — so when tasks execute, the plan already carries the knowledge context. This is simpler than modifying the runner: no changes to `buildPromptForTask()`, no qmd dependency in the execution path, the planner's main context never sees raw search output, and the user can review which prior knowledge was incorporated during plan review.

For **ingestion**: the user runs `/engy:ingest` with a URL, file path, transcript reference, or raw text. The skill spawns its own ingestion subagent which applies the snapshot-vs-link rule (durable → `memory/references/`, non-durable → `memory/sources/`), drafts a distillation as a fleeting memory with `sources` populated, dispatches the `engy:research` subagent (separate Task call) to surface related permanent notes and contradictions, proposes candidate edits to existing notes for user review, and commits each step with the structured `memory(<op>):` commit messages defined in FR-TG1.8. Granola transcripts ingest through the same path via the user's Granola MCP — the ingestion subagent fetches the transcript, snapshots it, then runs the standard distillation flow. The resulting fleeting moves into the normal `/engy:review-memories` lifecycle; ingestion never auto-promotes.

For **knowledge research**: any skill can dispatch the `engy:research` subagent via the Task tool. For ad-hoc terminal use, the user runs `/engy:research` (a thin skill that immediately dispatches the same subagent) with a question like "what do we know about JWT rotation?". The subagent searches across all four collections (system, docs, projects, memory), walks `sources`/`linkedMemories`/`scenarioIds` links to assemble a provenance trail, and returns a synthesized answer with citations. This is the Librarian role made first-class.

### Tasks

1. **Project completion pipeline & archival** (depends on TG1, TG3)

   * Files: `web/src/server/services/project-completion.ts` [NEW], `web/src/server/trpc/routers/project.ts` [MODIFY]

   * Implements FR-TG4.1, FR-TG4.3

   * Create `ProjectCompletionService` with two server-side phases:

     * **Distillation**: Query all unpromoted fleeting memories workspace-wide (fleetings have no `projectId`; the workspace pile is the unit). Sort by age and signal (has tags? non-empty source? referenced by other tasks?). Wire into `project.startCompletion` tRPC mutation — sets project status to `completing`, returns the candidate list. Candidates appear in the Memory tab's "Review Candidates" section. Deduplication against permanent memories is deferred to the review step (qmd search per candidate inside `/engy:review-memories`), keeping distillation a cheap structured query.

     * **Archival**: `project.archive` tRPC mutation — sets status to `archived`. Delete agent sessions and execution logs only. Preserve: plan content, milestones, task groups, tasks (with final statuses), permanent memories, fleeting memories (workspace-scoped, user-managed), key decisions.

2. **System doc proposal skill** (depends on TG1, depends on task 6 for `engy:research`)

   * Files: `plugins/engy/skills/propose-sysdocs/SKILL.md` [NEW]

   * Implements FR-TG4.2

   * Terminal skill `/engy:propose-sysdocs`: reads project context via MCP (completed tasks, promoted memories, existing system docs), dispatches the `engy:research` subagent (Task) to gather prior decisions and supporting notes for the project's domain, analyzes what knowledge should be captured in system docs, writes proposed updates/new files to `{workspaceDir}/system/` citing the returned sources. Changes are regular file writes (not worktree) — visible in the diff viewer's "Latest Changes" view for review. User approves or sends feedback via the batched review model.

3. **Completion output memories** (depends on TG1)

   * Files: `client/src/runner/agent-spawner.ts` [MODIFY], `client/src/runner/index.ts` [MODIFY], `common/src/ws/protocol.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY]

   * Implements FR-TG4.5

   * Extend `TASK_COMPLETION_SCHEMA` in `agent-spawner.ts:28-35` (currently `{ taskCompleted: boolean, summary: string }`) to add `memories: { content: string, type?: string }[]` (optional). The summary continues to flow into `agentSessions.completionSummary` as today; memories are a new sibling field that travels separately. In `index.ts` `handleCompletion()`, when completion output contains memories, send them to the server via a new `CREATE_MEMORIES_REQUEST` WebSocket message (add to `common/src/ws/protocol.ts`). Server handler in `ws/server.ts` receives the message and inserts fleeting memories scoped to the task's workspace (no `projectId`); `source` is set to `agent`. Provenance to the originating session is recoverable via the WS message's session/task identifiers, but is not persisted as a column on the fleeting memory.

4. **Review-memories skill** (depends on TG3 for `search`)

   * Files: `plugins/engy/skills/review-memories/SKILL.md` [NEW]

   * Implements FR-TG4.9, FR-TG4.10

   * Terminal skill `/engy:review-memories`: queries unpromoted fleeting memories via the existing `listMemories` MCP tool (fleetings live only in the SQLite `fleetingMemories` table — they have no markdown file, so the qmd `memory` collection cannot return them; `search` with `collection: 'memory'` is for permanent memories). The skill filters the returned list to unpromoted entries client-side. LLM-driven enrichment (proposed type/subtype/title/keywords/themes/tags) runs inside the skill's main Claude Code agent context — no separate server-side LLM call, no extra API key/budget. Iterates through each candidate. For each: (a) uses LLM to propose type/subtype, title, keywords, themes, tags, and optional `repo` based on content (enrichment), (b) calls `search` to find duplicate/similar permanent memories, (c) detects conflicts — supersession (same topic, newer info), contradiction (conflicting claims), (d) presents the candidate with proposed metadata + any duplicates/conflicts found, (e) user chooses: approve (promote with suggested metadata + auto-link via qmd), edit (modify before promoting), supersede (promote + mark existing as superseded), contradict (flag for resolution), or skip. Usable both during project completion and as ongoing maintenance — promotion is not gated on project close.

5. **Skill updates (implement, plan, milestone-plan, complete-project, bootstrap, sysdoc-assistant)** (depends on TG1-T3 for `updateTask` memories param, depends on task 3 for completion output schema, depends on task 6 for `engy:research`)

   * Files: `plugins/engy/skills/implement/SKILL.md` [MODIFY], `plugins/engy/skills/plan/SKILL.md` [MODIFY], `plugins/engy/skills/milestone-plan/SKILL.md` [MODIFY], `plugins/engy/skills/complete-project/SKILL.md` [NEW], `plugins/engy/skills/bootstrap-sysdocs/SKILL.md` [NEW], `plugins/engy/skills/sysdoc-assistant/SKILL.md` [NEW]

   * Implements FR-TG4.4, FR-TG4.6, FR-TG4.7, FR-TG4.8

   * Update `engy:implement`: instruct agents to (a) call `updateTask` with `memories` array for learnings captured in-flight, (b) include memories in the structured completion output. Emphasize capturing non-obvious patterns, gotchas, and architectural decisions.

   * Update `engy:plan` and `engy:milestone-plan`: add a "knowledge research" step that **dispatches the `engy:research` subagent** via the Task tool (`Task({ subagent_type: 'engy:research', prompt: '<question + project/milestone/repo context>' })`). The subagent returns a curated digest — typically 3–8 hits with one-line "why this matters here" annotations and inline citations. The planner folds the digest into the relevant plan section (overview / requirements / tasks), wrapped in `<!-- engy:research synthesized YYYY-MM-DD -->` and `<!-- /engy:research -->` markers so future readers can identify LLM-synthesized content and re-run the research step against current memory state. qmd's hybrid ranking determines retrieval order; the planner includes `filters.repo` in the prompt when the work is repo-local. This fulfills FR-7.13 through planning, not runtime injection — `buildPromptForTask()` is unchanged.

   * `engy:complete-project`: Orchestrates the completion flow exactly as described in the **Execution Mechanics** section above (steps 1–5). The skill pauses for user confirmation between phases and hands off to `engy:review-memories` and `engy:propose-sysdocs` as separate skill invocations rather than inline subagents — keeping each phase reviewable and resumable.

   * `engy:bootstrap-sysdocs`: Reads codebase structure via MCP tools (listFiles, searchRepoFiles), analyzes key modules/patterns/APIs, dispatches the `engy:research` subagent (Task) to fold any existing knowledge into the proposed docs, generates initial system docs (overview.md, features/*.md, technical/*.md) and writes to `{workspaceDir}/system/`. Presents docs for review before finalizing.

   * `engy:sysdoc-assistant`: Interactive skill for editing system docs — navigates system doc tree, opens files, dispatches the `engy:research` subagent (Task) for context when appropriate, assists with content updates, ensures consistency with codebase. Scoped to `{workspaceDir}/system/` directory.

6. **Research subagent + thin wrapper skill** (depends on TG3-T3 for `search.query` tRPC and TG3-T5 for the `search` MCP tool with frontmatter filters)

   * Files: `plugins/engy/agents/engy-research.md` [NEW], `plugins/engy/skills/research/SKILL.md` [NEW]

   * Implements FR-TG4.11

   * **Subagent definition (`plugins/engy/agents/engy-research.md`)** — frontmatter declares `name: engy:research`, `description` (use case + when to dispatch), `tools` whitelist (the unified `search` MCP tool, file Read for link-walking, no Write tools — research is read-only). Filename and frontmatter `name` follow the existing pattern of `plugins/engy/agents/engy-reviewer.md` (`name: engy:reviewer`) and `engy-srs-reviewer.md` in the same plugin — the colon-namespaced name comes from the frontmatter, not from auto-namespacing. `subagent_type` callers pass to the `Task` tool is `engy:research`. System prompt instructs the subagent to: (a) call `search` across the relevant collections (default: all four — system, docs, projects, memory), using semantic query plus structured filters when scope hints exist (`filters.repo`, `filters.scenarioIds`, etc.); (b) walk frontmatter links — for each promising hit, follow `sources` to the underlying snapshot or reference, follow `linkedMemories` to related notes, follow `scenarioIds` into system docs and tests; (c) evaluate genuine relevance (not just keyword overlap); (d) return a synthesized digest with inline citations of the form `memory/decisions/...md`, `memory/sources/...md`, `system/features/auth.md#FR-3.4`. Output format: a markdown block with 3–8 cited findings plus a one-line "why this matters here" annotation per finding. Caller-skills invoke via `Task({ subagent_type: 'engy:research', prompt })`.

   * **Thin skill wrapper (`skills/research/SKILL.md`)** — `/engy:research <question>`. The skill body simply instructs the main agent to dispatch the `engy:research` subagent via Task with the user's question and any scope hints from the current context (active project/milestone/repo from session state). Prints the returned digest to the user. Single-purpose; no logic beyond the dispatch.

7. **Ingest skill** (depends on TG1-T1 for `memory/sources/`, `memory/references/`, the `sources` frontmatter field, and the `memory(<op>):` commit message convention; depends on TG3-T5 for the `search` MCP tool; depends on TG3-T6 for the `reindex` MCP tool; depends on task 6 of TG4 for the research subagent)

   * Files: `plugins/engy/skills/ingest/SKILL.md` [NEW]

   * Implements FR-TG4.12

   * Skill `/engy:ingest <url-or-path-or-text>`: accepts a URL, file path, raw text, or transcript reference (e.g., a Granola meeting ID). The skill prompt drives the main agent (or dispatches a dedicated ingestion subagent via Task — see note below) to:

     1. **Classify durability** — link (durable: stable internal docs, repo paths with SHA, versioned public RFCs/specs) vs snapshot (non-durable: Slack threads, meeting transcripts, articles with link rot, PDFs from random URLs, emails, podcasts, photos of whiteboards). **Fetch validation for URL inputs:** scheme must be `http` or `https` (reject `file://`, `javascript:`, `gopher://`, etc.); cap fetched body at **5 MB** and snapshot body at **2 MB** of markdown after extraction (truncate with a clear `[truncated — original was N bytes]` marker); cap redirect chain at 5 hops.

     2. **Write the source record FIRST** (before any research dispatch) — for links, write a reference markdown file to `memory/references/{slug}.md` with frontmatter only (url, type, title, description). For snapshots, write an immutable markdown file to `memory/sources/{YYYYMMDDHHmm}-{slug}.md` with provenance frontmatter (url or origin, source_type, ingester, title) and the snapshot content in the body. Granola transcripts: fetch via the user's `mcp__claude_ai_Granola__*` MCPs (personal-environment-dependent — not bundled with the engy plugin), then snapshot. Writing the source record first ensures `engy:research` (step 4) reads from the immutable on-disk artifact, not transient text in the subagent's prompt.

     3. **Draft a fleeting distillation** — `createFleetingMemory` with the four-part shape (core claim, what surprised, what it connects to, what it contradicts) and `sources: [<path-to-source-record>]` populated.

     4. **Dispatch the `engy:research` subagent** — `Task({ subagent_type: 'engy:research', prompt: '<source content + "find related permanent notes and contradictions"> + filters.repo if repo-related' })`. The subagent returns related permanent notes and any flagged contradictions with prior positions.

     5. **Propose candidate edits** — if research surfaces existing permanent notes that should be updated in light of the new source, write the proposed edits directly to the affected files (uncommitted, working-tree changes only — not yet committed). The user reviews via the existing **diff viewer's "Latest Changes" mode** (same model as `/engy:propose-sysdocs`, FR-TG4.2): they see a normal git diff of the proposed changes, can accept (commit) or reject (revert) per the batched review flow. No special approval UI is built. Notes are not auto-modified — committing requires explicit user action via the diff viewer.

     6. **Commit with structured message** — every git commit during ingest uses the `memory(ingest):` convention from FR-TG1.8 with `source_path`, `distillation_id`, `candidate_edits`, and `contradictions` fields. `git log --grep='^memory(ingest):'` becomes the operations log; no `log.md` file is written.

     7. **Trigger reindex** — call the `reindex` MCP tool with `collection: 'memory'` (TG3-T6). The server-side `WorkspaceIndexer.update('memory')` runs `store.update()` + `store.embed()` + frontmatter-table sync; qmd's content hashing skips already-indexed files so the cost is bounded to the few files this ingest just wrote. Returns structured counts the skill prints to the user (e.g., "indexed 3 files, 0 unchanged, 2 needsEmbedding completed").

     Note: classifying + writing source files + drafting the distillation are mostly mechanical and can run in the main agent's context. If the source is large (e.g., long meeting transcript) the skill should dispatch an ingestion subagent (separate Task call) for the classification + distillation step to keep the user-facing context light. Ingestion never auto-promotes the distillation; it joins the standard `/engy:review-memories` lifecycle.

**Parallelizable:** Tasks 2, 4, and 6 (skill/agent file content only) can run in parallel with tasks 1 and 3 once their dependencies are met. Tasks 1 and 3 modify different files (`project.ts` vs `client/src/runner/`) and can run in parallel. Task 7 depends on task 6 (research subagent definition) but is otherwise independent. Task 5 depends on tasks 3 (completion output schema), 6 (research subagent), and TG1-T3 (updateTask memories), so it runs after those complete.

### Completion Summary

{Updated after TG completes}

## Out of Scope

* Multi-hop research / concept exploration (v1 feature — could add later as a skill; `engy:research` is single-pass)

* Memory linking graph UI (linkedMemories tracked in frontmatter but no visualization — could add as a future TG)

* Automatic background cleanup scheduler (v1 feature — replaced by on-demand `/engy:review-memories` skill)

* Automatic memory evolution (v1 feature — supersession is manual via review-memories skill, not automatic)

* Cross-workspace search (out of scope per spec §1.2)

* Embedding cache management (qmd handles internally)

* qmd MCP server exposure (using SDK directly, not qmd's built-in MCP server)

* qmd local model bootstrap UX is **partially in scope**: the first call to `store.embed()` after a fresh install triggers qmd's GGUF download (multi-GB, can take minutes). The `WorkspaceIndexer` logs progress to the server log; the `engy:reindex` skill streams those log lines to the user so they see "downloading qmd model... 47%" rather than a frozen terminal. Cache location is qmd's default (typically `~/.cache/qmd`). Network failure is reported as a recoverable error; `engy:validate` reports `needsEmbedding > 0` until the model is present. UI-side first-run wizard is deferred to M8 dashboard polish.

* Standalone `engy:check-contradictions` Interlocutor skill (always-on prior-art surfacing during a session). Contradiction-flagging happens inside `engy:ingest` against the freshly ingested source. A dedicated ad-hoc contradiction checker can come later if the in-ingest flagging proves insufficient.

* Cross-plane lint pass (every system-doc claim has a Zettelkasten note explaining why; every major decision note is reflected in a system doc). Schema fields (`scenarioIds`, `sources`) make this checkable; the lint itself is a future addition. `engy:validate` (TG3-T6) covers broken links, schema compliance, duplicate IDs, orphans, and lifecycle consistency only.

* Access-pattern-based auto-promotion of fleetings (retrieval telemetry-driven). Promotion stays manual via `/engy:review-memories`. Worth designing toward but not building in M7.

* Personal layer above projects (cross-workspace personal preferences/frameworks). Out of scope per spec §1.2; would require workspace-cross knowledge plumbing.

* Background per-task enrichment (v1 REQ-RETRIEVE-013–016 — "when a task is created or updated, queue a background job to search project memories for relevant context"). The planning-time-only injection model (FR-TG4.4) makes this redundant: relevant prior knowledge is already woven into the plan document the task derives from, so a separate per-task enrichment job would re-derive the same context.

* Discrete `research_memories`, `find_related`, `explain_connection` MCP tools (v1 REQ-MCP-007–009). The unified `search` MCP tool (FR-TG3.6) plus the `engy:research` subagent (FR-TG4.11) cover the use cases without preserving v1's 1:1 tool surface.

* **Secret/sensitive content scrubbing** for snapshots (Slack threads, transcripts, articles may contain API keys, tokens, PII). M7 trusts the user's judgment about what they ingest. Future M8+ could add a `.engyignore` mechanism plus a snapshot-time scanner (e.g., regex for common secret patterns + a confirmation step). Single-user local-first scope makes this a known, accepted risk.

* **Snapshot retention/quota policy.** `memory/sources/` is append-only and unbounded; ten 200KB snapshots/day = ~70MB/year, plus qmd embeddings. M7 ships without retention limits or warnings. `engy:validate` could grow a "memory dir size" warning at thresholds (e.g., >1GB) but that's M8+.

* **LLM digest reproducibility.** The `engy:research` subagent's synthesis step is non-deterministic — same query at different times can produce different digests. Plans baked from research digests are therefore non-reproducible artifacts. M7 accepts this; the plan document itself becomes the reproducible record once the planner folds the digest in.

* **Frontmatter table performance at scale.** SQLite JSON1 array-membership full-scans the `frontmatter` table (no JSON content index). Fine for M7's expected scale (hundreds to low-thousands of memories per workspace); M8+ may need a normalized `frontmatter_field` table for hot-path filters if scale breaks the model.

* **Hash-collision handling for identical content.** qmd content-addresses by SHA-256, so two files with identical bodies share embeddings. Search returns both with identical scores; rerank tie-breaks unstably. Acceptable corner case; not addressed.

* **Provenance audit trail beyond `source` field.** Permanent memories carry `source: 'agent' | 'user' | 'system'`; the git commit author is the server's git config. Distinguishing "user-written" vs "agent-hallucinated" beyond this single field is out of scope. M8+ could add per-action attribution.

* **Multi-level subdirectories** under `memory/{subtype}/` (e.g., `memory/decisions/auth/`). M7 supports a flat layout per subtype; nested taxonomies are out of scope.

* **Binary attachments** (PDFs, images, video) as snapshots. `engy:ingest` can write a reference record pointing at a binary URL but does not OCR, transcribe, or embed binary content into a markdown snapshot. Image-based whiteboard photos are a future extension.

## Follow-Up: Spec Drift

The plan diverges from spec.md §6.9 in two categories — simplifications (existing FRs need to be relaxed) and additions (new FRs to add):

**Simplifications** (existing FRs need to be relaxed):

* **FR-7.3** — spec lists `scope` as a Memory tab filter; plan drops it (memories are workspace-scoped only, so the filter has nothing to vary over). Reflected in FR-TG2.3.
* **FR-7.10** — spec puts deduplication during distillation; plan moves dedup to the per-candidate review phase inside `/engy:review-memories` (each candidate gets a focused qmd search rather than a bulk pre-distillation pass). Reflected in FR-TG4.1 and FR-TG4.9.
* **FR-7.12** — spec says "discard fleeting memories" on archive; plan preserves them (FR-TG4.3).
* **FR-7.13** — diverges on two axes: (a) **ordering** — spec mandates project → workspace → repo memory ordering; plan delegates to qmd hybrid ranking with an optional `repo` filter; (b) **timing** — spec implies runtime injection into agent prompts (`buildPromptForTask()`); plan moves injection to planning time, baking memories directly into plan documents via the `engy:research` subagent dispatched by `engy:plan` and `engy:milestone-plan`. Both reflected in FR-TG4.4 and Execution Mechanics.
* **FR-7.16** — spec defines workspace-vs-repo scoping; plan drops the scope enum and treats `repo` as provenance metadata (FR-TG1.2).
* **FR-7.17** — spec lists `scope` in the permanent memory schema; plan omits it (FR-TG1.1).

**Additions** (new FRs need to be added to spec.md §6.9, sourced from the three-planes knowledge model):

* Permanent memory frontmatter must include `scenarioIds: string[]` (cross-plane bridge to system docs and tests) and `sources: string[]` (provenance trail to records under `memory/sources/` or `memory/references/`) — extends FR-7.17.
* The `memory/` directory must include `sources/` (immutable snapshots of non-durable content) and `references/` (durable external link records) — new FR. Operations log lives in git history per the structured `memory(<op>):` commit message convention; no separate `log.md` file.
* The system must provide a reusable `engy:research` subagent (Task tool target) that searches across all four indexed collections (system, docs, projects, memory) and walks frontmatter links to return cited findings, plus a thin `/engy:research` skill wrapper for ad-hoc terminal use — new FR (Librarian role).
* The system must provide an `engy:ingest` skill that snapshots non-durable sources, links durable ones, drafts a distillation, and proposes candidate edits to existing notes — new FR (ingestion contract).

* Each collection (`system/`, `docs/`, `projects/`, `memory/` and its subtype dirs) must contain a `README.md` that serves as a **hierarchical human-readable table of contents**. Collection-root READMEs link to each subsection's README with a description and item count; subtype/leaf READMEs link to their files with frontmatter-derived summaries; mixed dirs render both lists. The auto-generated section is bracketed by `<!-- INDEX START --> / <!-- INDEX END -->` markers; everything outside the markers is hand-writable and preserved across regeneration. README frontmatter is just `description` (used by parent READMEs in their TOC bullets) — no index-state fields — new FR (README-as-wiki).

* Index freshness is owned by qmd via SHA-256 content hashing (qmd's `store.update()` skips files whose hash matches the existing index entry). The system does not track its own mtime/checksum or git SHAs. Fresh checkout: empty `.qmd/qmd.db` is auto-created; first `update()` rebuilds from source — new FR (qmd-owned freshness).

* The system maintains a `frontmatter` SQLite table indexing the YAML frontmatter of every markdown file across all four collections, queryable via SQLite JSON1 ops. Powers structured filters (tag, scenarioId, repo, source) and graph traversal (forward/backward link queries) for the unified `search` MCP tool and the `engy:research` subagent — new FR (frontmatter-as-graph).

* Memory operations log is git history, accessed via `git log --grep='^memory(<op>):'`. Commit messages follow a structured `memory(<op>): <summary>` + `key: value` body convention. No separate `log.md` file — new FR (operations-log-as-git-history).

Each plan FR carries a source annotation, but the spec itself was not updated. To prevent stale-source-of-truth confusion, file a separate doc-update task to revise spec.md §6.9 to match the simplified-and-extended model before M7 enters implementation.
