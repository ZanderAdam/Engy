---
title: Knowledge Layer
status: draft
---
# Plan: M7 Knowledge Layer

## Overview

M7 delivers the knowledge persistence layer — the system that makes Engy learn from every project. It encompasses the Docs tab (system docs + shared docs), the Memory tab (fleeting → permanent memory lifecycle with browser/editor), qmd-powered hybrid search (BM25 + vector + LLM reranking), project completion flow (memory distillation + system doc proposals + archival), and agent context injection with memory ordering.

The key architectural decision is using `@tobilu/qmd` as the search SDK. qmd runs entirely in-process via node-llama-cpp with local GGUF models — no external service, no ChromaDB sidecar. It indexes markdown files natively, provides hybrid search out of the box, and stores its index in SQLite (rebuildable from source files at any time).

Boundary: no multi-hop research exploration, no memory linking graph UI, no automatic background cleanup scheduler, no cross-workspace search.

## Codebase Context

**What M1–M6 shipped that M7 builds on:**

* **Database schema** (`web/src/server/db/schema.ts`): `fleetingMemories` table (workspace-scoped, types: capture/question/blocker/idea/reference, promoted flag, tags, source tracking) and `projectMemories` table (project-scoped, types: decision/fact/procedure/insight/preference, confidence, tags). Both exist but `projectMemories` is unused.

* **MCP tools** (`web/src/server/mcp/index.ts`): `createFleetingMemory` and `listMemories` already exposed to agents.

* **Docs page** (`web/src/app/w/[workspace]/docs/page.tsx`): Three-panel layout with `WorkspaceTree` (left) + `DynamicDocumentEditor` (center). Uses `EngyThreadStore` for BlockNote comment threads. File I/O via `dirRouter`.

* **Memory page** (`web/src/app/w/[workspace]/memory/page.tsx`): Empty stub (`<EmptyTab title="Memory" />`).

* **Comment system** (`web/src/server/trpc/routers/comment.ts`): Full BlockNote thread system — create/resolve/react. Used in docs and diff viewer. `documentPath` field encodes context scope.

* **Dir router** (`web/src/server/trpc/routers/dir.ts`): File read/write/list for workspace directories. Path validation. Recursive markdown file listing.

* **Execution context** (`web/src/server/trpc/routers/execution.ts`): `buildPromptForTask()` constructs agent system prompts with workspace/project context via `buildContextBlock()` in `lib/shell.ts`. No memory injection yet.

* **Diff viewer** (M5): Inline comments, split/unified diff, branch diff. Batched review model (review → comment → approve/send feedback).

* **Execution engine** (M6): Task/milestone execution, worktrees, agent sessions, `agentSessions` table with status tracking.

* **Workspace filesystem**: `{ENGY_DIR}/{workspace-slug}/` (configured via `ENGY_DIR` env var, defaults to `~/.engy/`, dev override `.dev-engy/`) with `system/`, `docs/`, `specs/`, `memory/` directories initialized by `engy-dir/init.ts`. Paths resolved at runtime via `getWorkspaceDetails().paths.workspaceDir`.

* **Component patterns**: `ThreePanelLayout` for sidebar+content+right, `FileTree` for file browsing, `TreeView` (Radix Accordion) for custom trees, URL search params for selection state, localStorage for panel widths.

**Engy v1 reference** (`/Users/aleks/dev/engy3/websocket/src/memory/`): v1 had a sophisticated memory system with ChromaDB + FTS5 + OpenAI embeddings, 14 link types, multi-hop research, automatic enrichment/evolution, and a cleanup scheduler with LLM-powered synthesis. M7 simplifies this dramatically — qmd replaces the entire search stack, and the memory lifecycle is streamlined to fleeting → promote → permanent. Memory files follow a Zettelkasten-style organization: `memory/{subtype}/{timestamp}-{slug}.md`, discoverable by browsing (subtype directories) and by search (qmd hybrid).

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

1. The system shall store permanent memories with full metadata: id, type, subtype (decision/pattern/fact/convention/insight), title, scope (workspace/repo), repo, confidence, source, keywords (low-level retrieval terms), themes (high-level conceptual terms), tags, linkedMemories, `supersededBy` (nullable FK to newer memory), and timestamps — as both SQLite records and markdown files with YAML frontmatter. Files organized Zettelkasten-style: `{workspaceDir}/memory/{subtype}/{YYYYMMDDHHmm}-{slug}.md` (e.g., `memory/decisions/202603231430-jwt-rotation-pattern.md`). Subdirectories by subtype: `decisions/`, `patterns/`, `facts/`, `conventions/`, `insights/`. *(source: FR-7.17, v1 REQ-FORMAT-001)* (FR-TG1.1)

2. The system shall support memory scoping: workspace-scoped memories (cross-project learnings) and repo-scoped memories (filtered by repo field). *(source: FR-7.16)* (FR-TG1.2)

3. The system shall support memory promotion: validate fleeting memory, create permanent memory record + markdown file, mark fleeting as promoted. *(source: FR-7.5)* (FR-TG1.3)

4. The system shall provide memory CRUD via tRPC (UI) and MCP (agents), with list/filter by type, subtype, scope, tags, and text search. *(source: FR-7.3, FR-7.4)* (FR-TG1.4)

5. The system shall surface recent unpromoted fleeting memories as periodic review candidates. *(source: FR-7.6)* (FR-TG1.5)

6. The system shall support manual memory creation and editing, both via UI (tRPC) and agents (MCP). *(source: FR-7.4)* (FR-TG1.6)

7. The `updateTask` MCP tool shall accept an optional `memories` array so agents can pass learnings captured during task implementation. *(source: user request)* (FR-TG1.7)

8. Memory file operations (create, update, delete) shall be committed to git with descriptive messages including operation type, memory title, and source. *(source: v1 REQ-GIT-001–007)* (FR-TG1.8)

9. When manual file edits are detected (via file watcher or on reindex), the system shall re-index the modified memories to maintain DB ↔ file consistency. *(source: v1 REQ-STORE-006–007)* (FR-TG1.9)

### Tasks

1. **Schema evolution & memory file utilities**

   * Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/XXXX_permanent_memories.sql` [NEW], `web/src/server/lib/memory-files.ts` [NEW]

   * Implements FR-TG1.1, FR-TG1.2, FR-TG1.8, FR-TG1.9

   * Add `permanentMemories` table with all FR-7.17 fields plus `supersededBy` (nullable self-FK), `keywords` (JSON array — low-level retrieval terms), `themes` (JSON array — high-level conceptual terms). Add `promotedFromId` and `promotedAt` to `fleetingMemories` for promotion tracking. Create `memory-files.ts` utility: write permanent memory as markdown with YAML frontmatter to `{workspaceDir}/memory/{subtype}/{YYYYMMDDHHmm}-{slug}.md` (Zettelkasten-style timestamp ID + human-readable slug), read memory file back to structured data, parse frontmatter, git commit after write/update/delete (via client daemon WebSocket git ops) with descriptive message. Add `syncFromFiles(workspaceDir)` function: scan memory files, reconcile with DB (detect manual edits via mtime/checksum comparison, upsert changed records). Ensure subtype directories (`decisions/`, `patterns/`, `facts/`, `conventions/`, `insights/`) are created on first write. Generate Drizzle migration.

2. **Memory tRPC router** (depends on task 1)

   * Files: `web/src/server/trpc/routers/memory.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]

   * Implements FR-TG1.3, FR-TG1.4, FR-TG1.5, FR-TG1.6

   * Endpoints: `create` (permanent memory → DB + file), `update` (DB + file sync), `delete` (DB + file), `get` (by id), `list` (filter by type/subtype/scope/repo/tags, text search, pagination), `promote` (fleeting → permanent: validate, create permanent, write file, mark fleeting promoted), `reviewCandidates` (recent unpromoted fleeting memories sorted by age). Follow existing router patterns (workspace slug resolution, input validation with zod).

3. **MCP memory tools expansion & updateTask memories** (depends on task 1)

   * Files: `web/src/server/mcp/index.ts` [MODIFY]

   * Implements FR-TG1.4, FR-TG1.6, FR-TG1.7

   * Add tools: `createPermanentMemory` (full metadata), `updatePermanentMemory`, `promoteMemory` (fleeting → permanent). Deprecate `listMemories` — replaced by unified `search` tool in TG3. Extend `updateTask` tool to accept optional `memories: { content: string, type?: string }[]` — when provided, creates fleeting memories linked to the task's project and workspace. Follow existing MCP tool patterns (zod schemas, JSON text responses).

**Parallelizable:** Tasks 2 and 3 have no file conflicts and can run concurrently after task 1 completes.

### Completion Summary

{Updated after TG completes}

## TG2: Knowledge UI (Docs + Memory Tabs)

Builds the workspace UI for browsing docs and memories. Enhances the existing Docs tab with system/docs tree separation and builds the Memory tab from scratch with browser + detail layout, filters, CRUD, and promotion flow.

### Requirements

1. The system shall display the Docs tab with tree + editor layout, separating `system/` (features/, technical/) and `docs/` (shared conventions, guides) with section headers. *(source: FR-7.1)* (FR-TG2.1)

2. The system shall support inline comments on documents using the existing BlockNote thread system. *(source: FR-7.2)* (FR-TG2.2)

3. The system shall provide a Memory tab with browser (left panel: list with filter by type, scope, tags + search) and detail view (right panel: content editor, metadata display). *(source: FR-7.3)* (FR-TG2.3)

4. The system shall support manual memory creation via a create form and editing via the detail view content editor. *(source: FR-7.4)* (FR-TG2.4)

5. The system shall provide a promotion flow: select fleeting memory → promote dialog (choose type/subtype, add title, confirm) → creates permanent memory. *(source: FR-7.5)* (FR-TG2.5)

6. The system shall surface periodic review candidates (recent unpromoted fleeting memories) with a review section or badge in the Memory tab. *(source: FR-7.6)* (FR-TG2.6)

7. The promotion flow shall check for duplicate/similar existing permanent memories via the search API (when available) and surface them to the user — options: skip, supersede existing, or promote anyway. *(source: user request — v1 feature brought back)* (FR-TG2.7)

### Tasks

1. **Docs tab enhancement**

   * Files: `web/src/app/w/[workspace]/docs/page.tsx` [MODIFY]

   * Implements FR-TG2.1, FR-TG2.2

   * Add collapsible section headers ("System Docs" / "Shared Docs") to the `WorkspaceTree` using the existing `TreeView` accordion pattern, filtering to show only `system/` and `docs/` subtrees (exclude `specs/`, `memory/`, etc.). Verify inline comments work (already using `EngyThreadStore` + BlockNote `CommentsExtension` — should work out of the box). Add "New Document" action in top-right that scopes to the selected section.

2. **Memory tab: browser panel + list** (depends on TG1-T2)

   * Files: `web/src/app/w/[workspace]/memory/page.tsx` [MODIFY], `web/src/components/memory/memory-browser.tsx` [NEW], `web/src/components/memory/memory-filters.tsx` [NEW]

   * Implements FR-TG2.3, FR-TG2.6

   * Replace `EmptyTab` with two-panel layout (reuse `ThreePanelLayout` pattern from docs page). Left panel: memory list with filter dropdowns (type, subtype, scope), tag chips, search input. Sort by date/confidence. Tab or section for "Review Candidates" (unpromoted fleeting memories) using `memory.reviewCandidates` query. Memory items show: title/content preview, type badge, scope badge, confidence, date.

3. **Memory tab: detail view, CRUD & promotion** (depends on task 2)

   * Files: `web/src/components/memory/memory-detail.tsx` [NEW], `web/src/components/memory/memory-form.tsx` [NEW], `web/src/components/memory/promote-dialog.tsx` [NEW]

   * Implements FR-TG2.4, FR-TG2.5, FR-TG2.7

   * Right panel: selected memory detail with BlockNote content editor (editable), metadata display (type, subtype, scope, repo, confidence, source, tags, linked memories, timestamps). Create form for new permanent memories (title, content, type/subtype, scope, tags). Promote dialog: triggered from review candidates list, select type/subtype, add title, confirm → calls `memory.promote` mutation. Duplicate check: before promoting, call `search.query` with the memory content — if similar permanent memories found (score > threshold), show them in the dialog with options: skip (don't promote), supersede (promote + mark existing as superseded), or promote anyway. Gracefully degrades if search API is not yet available (TG3 not complete).

**Parallelizable:** Task 1 (docs) has no dependencies and can run in parallel with tasks 2–3. Tasks 2 and 3 are sequential (detail builds on browser layout).

### Completion Summary

{Updated after TG completes}

## TG3: qmd Hybrid Search

Integrates `@tobilu/qmd` for hybrid search across all workspace content. Sets up the qmd store with collections, builds an indexing pipeline triggered by file changes, exposes search via tRPC, and adds reindex/validate terminal skills.

### Requirements

1. The system shall integrate qmd (`@tobilu/qmd`) to index all content (specs, docs, tasks, memories) as collections with path-specific context. *(source: FR-7.7)* (FR-TG3.1)

2. The system shall provide a search API using qmd hybrid search (BM25 + vector + LLM reranking) combined with SQLite structured queries, with results grouped by content type (docs, specs, tasks, memories). *(source: FR-7.8)* (FR-TG3.2)

3. The system shall provide `engy reindex` to rebuild the qmd store (`store.update()` + `store.embed()`) and `engy validate` for broken links, schema compliance, duplicate IDs, orphaned content, and lifecycle consistency. *(source: FR-7.9)* (FR-TG3.3)

4. The system shall support `engy validate` and `engy reindex` as terminal skills — not just CLI commands. *(source: FR-7.18)* (FR-TG3.4)

5. The system shall provide a global search bar on every page with results grouped by type. *(source: inferred from UI design context — header search)* (FR-TG3.5)

6. The system shall expose a unified `search` MCP tool that searches across all content types (docs, specs, memories, tasks). Accepts optional `query` (semantic search via qmd), optional `collection` filter (docs/specs/memory/tasks), and optional structured `filters` (type, scope, repo, tags — for memories; status — for tasks). When only filters are provided without a query, falls back to SQLite structured query. Replaces `listMemories` and `listPermanentMemories`. *(source: user request — single search surface for agents)* (FR-TG3.6)

7. When a permanent memory is created or promoted, the system shall use qmd search to find related existing memories and establish bidirectional links (type: `relates_to`, `derived_from`, etc.) in both memory files' frontmatter. Link candidates above a similarity threshold are written automatically; the `/engy:review-memories` skill can refine link types. *(source: v1 REQ-LINK-001–004)* (FR-TG3.7)

### Tasks

1. **qmd store setup & collection configuration**

   * Files: `web/package.json` [MODIFY], `web/src/server/search/qmd-store.ts` [NEW]

   * Implements FR-TG3.1

   * Install `@tobilu/qmd`. Create `QmdStoreManager` singleton: lazy-initializes one qmd store per workspace. Store database at `{ENGY_DIR}/{workspace-slug}/.qmd/qmd.db`. Configure collections: `system` (path: `system/`, pattern: `**/*.md`), `docs` (path: `docs/`, pattern: `**/*.md`), `specs` (path: `specs/`, pattern: `**/*.md`), `memory` (path: `memory/`, pattern: `**/*.md`). Add collection-level context describing each content type for relevance tuning. Export `getStore(workspaceSlug)` accessor.

2. **Indexing pipeline** (depends on task 1)

   * Files: `web/src/server/search/indexer.ts` [NEW], `web/src/server/trpc/routers/dir.ts` [MODIFY]

   * Implements FR-TG3.1

   * Create `WorkspaceIndexer`: `fullReindex(workspaceSlug)` runs `store.update()` + `store.embed()` for all collections, then calls `syncFromFiles()` (from TG1) to reconcile DB with any manual file edits. `incrementalUpdate(workspaceSlug, collection)` updates a single collection. Hook into `dir.write` and `dir.delete` mutations to trigger incremental updates after file changes. Run initial full index on first store access. Handle embedding progress via logging (not blocking UI).

3. **Search tRPC router** (depends on task 2)

   * Files: `web/src/server/trpc/routers/search.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]

   * Implements FR-TG3.2

   * Search router: `search.query(workspaceSlug, query, collection?, limit?)` — calls `store.search()` with hybrid mode, combines with SQLite task query (`LIKE` on title/description), returns results grouped by type (docs, specs, memories, tasks) with title, path, snippet, score. Note: `root.ts` is also modified by TG1-T2 (memory router), but TG1 completes before TG3 starts — no conflict.

4. **Global search UI** (depends on task 3)

   * Files: `web/src/components/search/global-search.tsx` [NEW], `web/src/components/layout/header.tsx` [MODIFY]

   * Implements FR-TG3.5

   * Global search component: command palette style (Cmd+K), debounced input, calls `search.query`, grouped results with navigation on click. Wire into header search icon.

5. **Unified `search` MCP tool & auto-linking** (depends on task 3)

   * Files: `web/src/server/mcp/index.ts` [MODIFY], `web/src/server/search/auto-linker.ts` [NEW]

   * Implements FR-TG3.6, FR-TG3.7

   * Unified `search` MCP tool: accepts `workspaceId`, optional `query` (semantic), optional `collection` (docs/specs/memory/tasks), optional `filters` (type, scope, repo, tags, etc.). With `query` → delegates to `search.query` tRPC (qmd hybrid search + SQLite for tasks), returns grouped results with snippets. Without `query` but with `filters` → SQLite structured query (e.g., list all decision memories for a repo). Replaces deprecated `listMemories` and planned `listPermanentMemories`. Used by planning skills, `engy:review-memories`, and any agent that needs to find content. Note: `mcp/index.ts` is also modified by TG1-T3 (memory tools), but TG1 completes before TG3 — no conflict. `autoLink(memoryId)` function in `auto-linker.ts`: on memory creation/promotion, search qmd for related memories (score > threshold), write bidirectional `relates_to` links in both files' frontmatter, commit changes. Guard: auto-link writes must NOT trigger recursive re-linking (use a flag to skip the dir.write → reindex → autoLink cycle).

6. **Reindex & validate terminal skills** (depends on task 1)

   * Files: `plugins/engy/skills/reindex/SKILL.md` [NEW], `plugins/engy/skills/validate/SKILL.md` [NEW]

   * Implements FR-TG3.3, FR-TG3.4

   * `engy:reindex` skill: calls `fullReindex()` via MCP tool or direct invocation, reports progress and result counts. `engy:validate` skill: checks broken links between documents, schema compliance of memory frontmatter, duplicate IDs, orphaned content (files without DB records and vice versa), lifecycle consistency (promoted fleeting memories have corresponding permanent records). Reports findings grouped by severity. Note: `reindex` skill references tools from tasks 1-2 — write after store API is established.

**Parallelizable:** Task 6 can start after task 1. Tasks 4 and 5 can run in parallel after task 3 completes. Dependency chain: T1 → T2 → T3 → {T4, T5} parallel. T6 independent after T1.

### Completion Summary

{Updated after TG completes}

## TG4: Completion Flow & Agent Integration

Closes the knowledge feedback loop. On project completion: distill memories, propose system doc updates, archive the project. Inject memory context into agent prompts. Add bootstrap and sysdoc-assistant skills.

### Requirements

1. The system shall run memory distillation on project completion (server-side, no agent): evaluate project fleeting memories for promotion, deduplicate against existing permanent memories using qmd search, surface promotion candidates in the Memory tab. *(source: FR-7.10)* (FR-TG4.1)

2. The system shall provide a `/engy:propose-sysdocs` terminal skill that proposes system doc updates based on project context — writes proposed changes to `{workspaceDir}/system/`, reviewable via diff viewer's "Latest Changes" using the batched review model. *(source: FR-7.11)* (FR-TG4.2)

3. The system shall archive completed projects: compact (preserve plan content, milestones, groups, task structure, key decisions, final statuses), discard agent session state, fleeting memories, execution logs. *(source: FR-7.12)* (FR-TG4.3)

4. The system shall inject memory context to agents via the planning phase: `/engy:milestone-plan` and `/engy:plan` skills search memories via MCP and incorporate relevant learnings into plan documents, ordered by scope: project memories first, then workspace memories, then repo-scoped memories. *(source: FR-7.13)* (FR-TG4.4)

5. The async background agent structured completion output (`--json-schema`) shall include a `memories` array for learnings captured during execution, which the runner persists as fleeting memories. *(source: user request)* (FR-TG4.5)

6. The implementation skill (`engy:implement`) shall instruct agents to pass memories via both `updateTask` and the completion output. The planning skills (`engy:plan`, `engy:milestone-plan`) shall search memories via MCP and incorporate relevant learnings into plans. *(source: user request)* (FR-TG4.6)

7. The system shall provide a bootstrap skill that reads codebase via client connection and proposes initial system docs for review. *(source: FR-7.14)* (FR-TG4.7)

8. The system shall provide an `engy:sysdoc-assistant` Claude Code skill for editing system docs. *(source: FR-7.15)* (FR-TG4.8)

9. The system shall provide an `/engy:review-memories` terminal skill that uses LLM + qmd search to review unpromoted fleeting memories: proposes type/subtype/title, suggests keywords/themes/tags, checks for duplicates and contradictions via `search`, handles supersession — user approves/rejects each candidate. Detects conflicts: supersession (same topic, newer info), contradiction (conflicting statements), scope conflicts (workspace vs repo disagree). *(source: user request + v1 REQ-CONFLICT-001–006)* (FR-TG4.9)

10. The system shall enrich memories at promotion time: LLM suggests keywords (low-level retrieval terms), themes (high-level conceptual terms), tags, and a concise title if not provided, lowering the friction of manual promotion. *(source: user request + v1 REQ-CREATE-002)* (FR-TG4.10)

### Execution Mechanics

The completion pipeline uses **terminal skills** (not background agents) because the user needs to review and approve at each step. The flow is:

1. User marks project as "completing" in the UI (or runs `/engy:complete-project` in terminal).

2. **Distillation** runs server-side (DB queries + qmd search — no agent needed). Surfaces promotion candidates in the Memory tab.

3. User runs `/engy:review-memories` in the terminal. The skill iterates through promotion candidates, uses LLM to propose type/subtype/title/tags for each, checks `search` for duplicates, and presents each candidate for approval. User approves (promote), rejects (discard), or supersedes (promote + mark existing as superseded). Alternatively, user can promote manually via the Memory tab UI.

4. **System doc proposals**: User runs `/engy:propose-sysdocs` skill in the terminal. The skill reads project context (completed tasks, promoted memories) and proposes system doc changes by writing files to `{workspaceDir}/system/`. Since the skill runs in the terminal (not a worktree), changes appear as uncommitted modifications visible in the diff viewer's "Latest Changes" mode. User reviews and approves via the batched review model.

5. **Archival**: User confirms archival via UI action. Server compacts the project.

**Ongoing memory maintenance** (not tied to project completion): User can run `/engy:review-memories` at any time to review accumulated fleeting memories. This replaces v1's cleanup scheduler with an on-demand skill.

For **agent context injection**: memories flow through **planning**, not execution. The `/engy:milestone-plan` and `/engy:plan` skills are updated to instruct the planning agent to search memories via the unified `search` MCP tool using the milestone/task description as context. Relevant learnings get written directly into the plan document — so when tasks execute, the plan already contains the memory context. This is simpler than modifying the runner: no changes to `buildPromptForTask()`, no qmd dependency in the execution path, and the user can review which memories were incorporated during plan review.

### Tasks

1. **Project completion pipeline & archival** (depends on TG1, TG3)

   * Files: `web/src/server/services/project-completion.ts` [NEW], `web/src/server/trpc/routers/project.ts` [MODIFY]

   * Implements FR-TG4.1, FR-TG4.3

   * Create `ProjectCompletionService` with two server-side phases:

     * **Distillation**: Query project's fleeting memories, score promotion worthiness (has tags? confidence > threshold? referenced by agent?), search qmd for existing permanent memories to avoid duplicates, return ranked promotion candidates. Wire into `project.startCompletion` tRPC mutation — sets project status to `completing`, runs distillation, returns candidates. Candidates appear in the Memory tab's "Review Candidates" section.

     * **Archival**: `project.archive` tRPC mutation — sets status to `archived`. Delete fleeting memories, agent sessions, execution logs. Preserve: plan content, milestones, task groups, tasks (with final statuses), permanent memories, key decisions.

2. **System doc proposal skill** (depends on TG1)

   * Files: `plugins/engy/skills/propose-sysdocs/SKILL.md` [NEW]

   * Implements FR-TG4.2

   * Terminal skill `/engy:propose-sysdocs`: reads project context via MCP (completed tasks, promoted memories, existing system docs), analyzes what knowledge should be captured in system docs, writes proposed updates/new files to `{workspaceDir}/system/`. Changes are regular file writes (not worktree) — visible in the diff viewer's "Latest Changes" view for review. User approves or sends feedback via the batched review model.

3. **Completion output memories** (depends on TG1)

   * Files: `client/src/runner/agent-spawner.ts` [MODIFY], `client/src/runner/index.ts` [MODIFY], `common/src/ws/protocol.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY]

   * Implements FR-TG4.5

   * Extend `TASK_COMPLETION_SCHEMA` in `agent-spawner.ts` to include `memories: { content: string, type?: string }[]`. In `index.ts` `handleCompletion()`, when completion output contains memories, send them to the server via a new `CREATE_MEMORIES_REQUEST` WebSocket message (add to `common/` protocol). Server handler in `ws/server.ts` receives the message and inserts fleeting memories linked to the task's project/workspace.

4. **Review-memories skill** (depends on TG3 for `search`)

   * Files: `plugins/engy/skills/review-memories/SKILL.md` [NEW]

   * Implements FR-TG4.9, FR-TG4.10

   * Terminal skill `/engy:review-memories`: queries unpromoted fleeting memories via the `search` MCP tool (collection: 'memory', filters: { promoted: false }), iterates through each candidate. For each: (a) uses LLM to propose type/subtype, title, keywords, themes, and tags based on content (enrichment), (b) calls `search` to find duplicate/similar permanent memories, (c) detects conflicts — supersession (same topic, newer info), contradiction (conflicting claims), scope conflict (workspace vs repo disagree), (d) presents the candidate with proposed metadata + any duplicates/conflicts found, (e) user chooses: approve (promote with suggested metadata + auto-link via qmd), edit (modify before promoting), supersede (promote + mark existing as superseded), contradict (flag for resolution), or skip. Usable both during project completion and as ongoing maintenance.

5. **Skill updates (implement, plan, milestone-plan, complete-project, bootstrap, sysdoc-assistant)** (depends on TG1-T3 for `updateTask` memories param, depends on task 3 for completion output schema)

   * Files: `plugins/engy/skills/implement/SKILL.md` [MODIFY], `plugins/engy/skills/plan/SKILL.md` [MODIFY], `plugins/engy/skills/milestone-plan/SKILL.md` [MODIFY], `plugins/engy/skills/complete-project/SKILL.md` [NEW], `plugins/engy/skills/bootstrap-sysdocs/SKILL.md` [NEW], `plugins/engy/skills/sysdoc-assistant/SKILL.md` [NEW]

   * Implements FR-TG4.4, FR-TG4.6, FR-TG4.7, FR-TG4.8

   * Update `engy:implement`: instruct agents to (a) call `updateTask` with `memories` array for learnings captured in-flight, (b) include memories in the structured completion output. Emphasize capturing non-obvious patterns, gotchas, and architectural decisions.

   * Update `engy:plan` and `engy:milestone-plan`: instruct the planning agent to use the unified `search` MCP tool (with `collection: 'memory'` and scope filters for workspace/repo, or semantic query for relevant context) and incorporate relevant past learnings into plan documents, ordered project → workspace → repo. This is how FR-7.13 (memory context injection) is fulfilled — through planning, not execution.

   * `engy:complete-project`: Orchestrates the completion flow — calls `project.startCompletion` to trigger distillation, guides user through memory review (delegates to `engy:review-memories`), then delegates to `engy:propose-sysdocs`, and finally triggers archival.

   * `engy:bootstrap-sysdocs`: Reads codebase structure via MCP tools (listFiles, searchRepoFiles), analyzes key modules/patterns/APIs, generates initial system docs (overview.md, features/*.md, technical/*.md) and writes to `{workspaceDir}/system/`. Presents docs for review before finalizing.

   * `engy:sysdoc-assistant`: Interactive skill for editing system docs — navigates system doc tree, opens files, assists with content updates, ensures consistency with codebase. Scoped to `{workspaceDir}/system/` directory.

**Parallelizable:** Task 2 (skill file only) and task 4 (skill file only) can run in parallel with tasks 1 and 3. Tasks 1 and 3 modify different files (`project.ts` vs `client/src/runner/`) and can run in parallel. Task 5 depends on tasks 3 (completion output schema) and TG1-T3 (updateTask memories), so it runs after those complete.

### Completion Summary

{Updated after TG completes}

## Out of Scope

* Multi-hop research / concept exploration (v1 feature — could add later as a skill)

* Memory linking graph UI (linkedMemories tracked in frontmatter but no visualization — could add as a future TG)

* Automatic background cleanup scheduler (v1 feature — replaced by on-demand `/engy:review-memories` skill)

* Automatic memory evolution (v1 feature — supersession is manual via review-memories skill, not automatic)

* Cross-workspace search (out of scope per spec §1.2)

* Embedding cache management (qmd handles internally)

* qmd MCP server exposure (using SDK directly, not qmd's built-in MCP server)
