---
description: Two-tier memory system — fleeting captures and durable permanent notes — with file-backed persistence, git commits, README indexing, and auto-linking.
order: 10
---

# Memory Management

Engy's memory system keeps engineering knowledge durable alongside the code that motivated it. It operates in two tiers: **fleeting memories** for quick, unrefined captures (DB-only, no file) and **permanent memories** for curated knowledge persisted as both a SQLite row and a markdown file inside the workspace's `memory/` directory.

## Architecture

### Fleeting memories

Stored in the `fleetingMemories` table. Each row carries `content`, `type` (`capture`), `source` (one of `agent`, `user`, `system`), optional `tags[]`, and optional `sources[]` (paths under `memory/sources/` or `memory/references/`). There is no corresponding markdown file; fleeting memories are ephemeral review candidates.

Captured via the `memory.createFleeting` tRPC procedure (`web/src/server/trpc/routers/memory.ts`) or the `createFleetingMemory` MCP tool (`web/src/server/mcp/index.ts`). Both enforce a Zod `min(1)` guard on `content`, rejecting empty content before any DB write. MCP defaults `source` to `'agent'`; tRPC defaults to `'user'`. Both accept an optional `type` (`capture` default) and optional `sources[]`. A daemon-originated third path, the `CREATE_MEMORIES_EVENT` WS message (`web/src/server/ws/server.ts`), lets agent sessions batch-capture memories without an MCP/tRPC round trip — see FR-MEMORY-250 for its distinct caps and clamping rules.

### Fleeting lifecycle: dismiss, restore, delete

A fleeting memory has three terminal-ish states beyond plain capture: `promoted` (unchanged — see Promotion below), `dismissedAt` (a tombstone timestamp), or plain deletion. Dismissal is suppress-and-preserve: the row stays in the DB with `dismissedAt` set and drops out of the default review queue, but remains restorable. `memory.dismissFleeting` / `memory.restoreFleeting` / `memory.deleteFleeting` (tRPC) and `dismissFleetingMemory` / `deleteFleetingMemory` (MCP) implement this. A memory that has already been promoted cannot be dismissed or deleted — the promoted permanent memory is the audit trail, and `memory.promote` / `promoteMemory` always clears `dismissedAt` when promoting (promoting from the dismissed view is a valid restore path). There is no `restoreFleetingMemory` MCP tool — restoring a dismissed item is a UI-only affordance; agents promote or delete instead.

### Permanent memories

Stored in the `permanentMemories` table **and** as a gray-matter markdown file at `memory/{subtype}s/YYYYMMDDHHMMSS-<slug>.md` relative to the workspace directory. Subtypes are `decision | pattern | fact | convention | insight` (mapped by `SUBTYPE_DIR_MAP` in `memory-files.ts`). Full metadata schema: `title`, `subtype`, `repo`, `confidence`, `keywords[]`, `themes[]`, `tags[]`, `linkedMemories[]`, `scenarioIds[]`, `sources[]`, `supersededBy` (optional path). The `filePath` column stores the workspace-relative path back-filled after the file is written.

All file writes go through `writePermanentMemory` and `rewritePermanentMemory` in `web/src/server/lib/memory-files.ts`. Git commits are made through `commitFile` (wrapping `simple-git`) under a `withWorkspaceLock` mutex to serialise concurrent writes per workspace.

### DB-first, compensating-delete pattern

On create and promote: the DB row is inserted first (`filePath: null`), then the file is written, then `filePath` is back-filled. If the file write throws, a compensating delete removes the DB row so no orphan exists. On delete: the file is unlinked first; if that succeeds the DB row is removed. This keeps the system in a recoverable state at every step.

### README chain regeneration

Any write or delete to a memory file calls `regenerateReadmeChain` (`web/src/server/lib/readme-index.ts`), which walks up from the file's directory to the workspace root regenerating the `<!-- INDEX START --> … <!-- INDEX END -->` block in each `README.md`. The walk stops at and never writes above the workspace root. Files within each directory sort by `order` frontmatter then alphabetically; prose above the markers is preserved.

### Subtype relocation on update

When `memory.update` changes the `subtype`, `rewritePermanentMemory` writes the file at `memory/{newSubtype}/<same filename>`, removes the old file, regenerates README chains for both the old and new directories, and rewrites `linkedMemories` references in every other memory file that pointed at the old path (`rewriteInboundLinks`). All touched paths are committed in a single `memory(edit):` commit.

### Auto-linking

After a permanent memory is created or promoted, `autoLink` (`web/src/server/search/auto-linker.ts`) runs fire-and-forget. It performs two passes under a workspace lock: (1) a similarity search via qmd (hybrid BM25 + vector) filtered above `SIMILARITY_THRESHOLD = 0.75`, capped at `MAX_LINKS = 5` candidates; (2) a tag/theme co-linking pass that fills remaining slots with workspace siblings sharing at least 2 tags or themes. Both source and candidate files are updated bidirectionally (file + DB), and all touched paths are committed in a single `memory(autolink):` commit. Skipped when `QMD_SKIP=1`.

### Source snapshots

Ingested reference material is stored under `memory/sources/` via `writeSourceSnapshot`. Before writing, the function computes a SHA-256 of the body and scans existing files' heads (512-byte partial read) for a matching `content_hash`. If a match is found the call returns early with `{ filePath, deduplicated: true }` and the original path — no file is created. The MCP `writeSourceSnapshot` tool re-maps this to `{ filePath, reused: true }` in its response payload.

### Review-candidate clustering (ad-hoc, never indexed)

`clusterReviewCandidates` (`web/src/server/search/candidate-clusters.ts`) groups a workspace's pending fleeting memories into similarity clusters so the review queue can be worked cluster-by-cluster instead of one row at a time. It embeds each candidate's content via `store.internal.llm.embedBatch` at call time — a deliberate product decision that fleeting memories are never indexed, so nothing from this pass is written to the qmd store. Clustering is greedy single-link (a candidate joins the first existing cluster containing any member at or above 0.88 cosine similarity — calibrated against raw unformatted embeddings, where a measured paraphrase pair scored 0.9158 and unrelated captures ~0.42 — else starts a new one), sorted largest-cluster-first with singletons last. Clustering is capped at the newest 200 pending candidates (`truncated: true` in the response when more exist). Like the rest of the memory LLM integrations, it degrades to one singleton cluster per memory — today's one-by-one review — when `QMD_SKIP=1` or the embedded LLM is unavailable, rather than erroring. Exposed via `memory.reviewCandidateClusters` (tRPC) and `listReviewClusters` (MCP), both read-only.

### Promote-proposal (AI-assisted)

`memory.proposePromotion` calls `proposeMemoryMetadata` (`web/src/server/lib/promote-proposal.ts`), which runs a qmd similarity search for context and then prompts the embedded LlamaCpp model (via `getStore`) to return a JSON proposal: `{ title, subtype, keywords, themes, tags, confidence, rationale, linkedMemories }`. Returns `null` when `QMD_SKIP=1` or when the LLM is unavailable.

### Broadcast

Every mutating operation (`create`, `update`, `delete`, `promote`, `dismissFleeting`, `restoreFleeting`, `deleteFleeting`) calls `broadcastMemoryChange(action, workspaceId, memoryId?)` (`web/src/server/ws/broadcast.ts`), which emits a `MEMORY_CHANGE` event with an `action` field (`'created' | 'updated' | 'deleted' | 'promoted' | 'dismissed' | 'restored'`) to all connected browser clients.

## Key files

| File | Role |
|---|---|
| `web/src/server/trpc/routers/memory.ts` | tRPC procedures: `create`, `update`, `delete`, `get`, `getByPath`, `list`, `promote`, `reviewCandidates`, `reviewCandidateClusters`, `createFleeting`, `dismissFleeting`, `restoreFleeting`, `deleteFleeting`, `proposePromotion` |
| `web/src/server/mcp/index.ts` | MCP tools: `createFleetingMemory`, `dismissFleetingMemory`, `deleteFleetingMemory`, `listMemories`, `createPermanentMemory`, `updatePermanentMemory`, `promoteMemory`, `writeSourceSnapshot`, `listReviewClusters` |
| `web/src/server/search/candidate-clusters.ts` | `clusterReviewCandidates` — ad-hoc embedding cosine clustering of pending fleeting memories; nothing persisted to the index |
| `web/src/server/ws/server.ts` | `handleCreateMemoriesEvent` — daemon-originated batch fleeting-memory capture from agent sessions (`CREATE_MEMORIES_EVENT`) |
| `web/src/server/lib/memory-files.ts` | File I/O: `writePermanentMemory`, `rewritePermanentMemory`, `writeSourceSnapshot`, `readPermanentMemory`, `validateSourcePath`, `validateLinkedMemoryPath`, `commitFile` |
| `web/src/server/lib/promote-proposal.ts` | `proposeMemoryMetadata` — LLM-driven promotion metadata proposal |
| `web/src/server/lib/readme-index.ts` | `regenerateReadmeChain`, `updateReadmeIndex` — README index regeneration |
| `web/src/server/search/auto-linker.ts` | `autoLink` — bidirectional link writing on create/promote |
| `web/src/server/search/indexer.ts` | `triggerMemoryIndexOnWrite` — fire-and-forget, per-workspace-serialized search index refresh (qmd hash scan, orphaned-vector cleanup, background embed) called after every permanent memory create/update/delete/promote |

## Requirements

Functional requirements in EARS notation. These are the single source of truth
for the memory-management feature's behaviour. Tag the verifying tests with the FR id in
their title string, e.g. `it('[FR-MEMORY-010] ...', ...)`, and run
`trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-MEMORY-010 | WHEN `createFleeting` or `createFleetingMemory` is called with non-empty content, the system SHALL insert a `fleetingMemories` row with `promoted=false` and return `{ id }`. |
| FR-MEMORY-020 | WHEN `createFleeting` or `createFleetingMemory` is called with empty content, the system SHALL reject the request with a validation error before any DB write. |
| FR-MEMORY-030 | WHEN a permanent memory is created via `memory.create` or `createPermanentMemory`, the system SHALL write a markdown file at `memory/{subtype}s/YYYYMMDDHHMMSS-<slug>.md`, back-fill `filePath` in the DB row, regenerate the README chain, and make a `memory(create): <title>` git commit. |
| FR-MEMORY-040 | IF the file write fails during permanent memory creation, THEN the system SHALL execute a compensating delete of the DB row and throw an INTERNAL_SERVER_ERROR, leaving no orphan row. |
| FR-MEMORY-050 | WHEN a permanent memory is updated with an unchanged subtype, the system SHALL rewrite the file at the existing path, merge only the supplied fields into the DB row, refresh `updatedAt`, and broadcast a `MEMORY_CHANGE` event with action `'updated'`. |
| FR-MEMORY-060 | WHEN a permanent memory update changes the subtype, the system SHALL move the file to `memory/{newSubtype}/<same filename>`, delete the old file, rewrite all inbound `linkedMemories` references to the new path, regenerate README chains for both directories, and make a single `memory(edit):` git commit. |
| FR-MEMORY-070 | WHEN a permanent memory's `supersededById` is set, the system SHALL write `supersededBy: <path>` into the file's frontmatter, and subsequent unrelated updates to that memory SHALL preserve the field. |
| FR-MEMORY-080 | The system SHALL exclude permanent memories where `supersededById` is non-null from all `memory.list` result sets. |
| FR-MEMORY-090 | WHEN a permanent memory is deleted, the system SHALL unlink the file, regenerate the README chain, make a `memory(delete): <title>` git commit, remove the DB row, and broadcast a `MEMORY_CHANGE` event with action `'deleted'`. |
| FR-MEMORY-100 | WHEN `memory.promote` or `promoteMemory` is called on an unpromotable fleeting memory, the system SHALL atomically insert a permanent row and mark the fleeting `promoted=true` with `promotedAt` and `promotedFromId` set, union the caller-supplied sources with the fleeting's own sources (dedup), write the permanent file, run `autoLink`, and broadcast a `MEMORY_CHANGE` event with action `'promoted'`. |
| FR-MEMORY-110 | WHEN `memory.promote` or `promoteMemory` is called on a fleeting memory that has already been promoted, the system SHALL return a BAD_REQUEST error and create no new permanent row. |
| FR-MEMORY-120 | WHEN `writeSourceSnapshot` or the `writeSourceSnapshot` MCP tool is called with content whose SHA-256 matches an existing file in `memory/sources/`, the system SHALL return the original file path and create no new file. The library and tRPC layer surfaces this as `deduplicated: true`; the MCP `writeSourceSnapshot` tool surfaces it as `reused: true`. |
| FR-MEMORY-130 | WHEN `writeSourceSnapshot` or the `writeSourceSnapshot` MCP tool is called with unique content, the system SHALL write a file at `memory/sources/YYYYMMDDHHMMSS-<slug>.md` with `content_hash` in frontmatter, regenerate the README chain, and make a `memory(ingest): <title>` git commit. |
| FR-MEMORY-140 | WHEN any memory file is written or deleted, the system SHALL regenerate the `<!-- INDEX START --> … <!-- INDEX END -->` block in each README from the file's directory up to and including the workspace root, preserving prose above the markers and never writing above the workspace root. |
| FR-MEMORY-150 | WHEN a permanent memory is created or promoted, the system SHALL run `autoLink` asynchronously, writing bidirectional `linkedMemories` entries (capped at `MAX_LINKS = 5`) into both the source and candidate files and committing all touched paths under a workspace lock. |
| FR-MEMORY-160 | WHEN `memory.proposePromotion` is called on a fleeting memory and the embedded LLM is available, the system SHALL return a proposal containing `title`, `subtype`, `keywords`, `themes`, `tags`, `confidence`, and `rationale`. |
| FR-MEMORY-170 | IF `QMD_SKIP=1` or the embedded LLM is unavailable, THEN `memory.proposePromotion` SHALL return `null` without error. |
| FR-MEMORY-180 | The system SHALL reject any `sources` path that is absolute, contains `..` segments, or does not resolve under `memory/sources/` or `memory/references/`, and any `linkedMemories` path that is absolute, contains `..` segments, or does not resolve under a valid `memory/{subtype}s/` directory. |
| FR-MEMORY-190 | WHEN `memory.dismissFleeting` or `dismissFleetingMemory` is called on an unpromoted fleeting memory, the system SHALL set `dismissedAt` to the current timestamp, leave the row in place, and broadcast a `MEMORY_CHANGE` event with action `'dismissed'`. IF the fleeting memory has already been promoted, THEN the system SHALL reject the request with a BAD_REQUEST error (MCP: an error result) and leave `dismissedAt` unchanged. |
| FR-MEMORY-200 | WHEN `memory.restoreFleeting` is called on a fleeting memory, the system SHALL null `dismissedAt` and broadcast a `MEMORY_CHANGE` event with action `'restored'`. |
| FR-MEMORY-210 | WHEN `memory.deleteFleeting` or `deleteFleetingMemory` is called on an unpromoted fleeting memory, the system SHALL hard-delete the row and broadcast a `MEMORY_CHANGE` event with action `'deleted'`. IF the fleeting memory has already been promoted, THEN the system SHALL reject the request with a BAD_REQUEST error (MCP: an error result) and delete nothing, since the promoted permanent memory is the audit trail. |
| FR-MEMORY-220 | WHEN `memory.promote` or `promoteMemory` succeeds, the system SHALL null the fleeting memory's `dismissedAt` regardless of its prior value, so promoting from the dismissed view is a valid restore path. |
| FR-MEMORY-230 | The system SHALL exclude fleeting memories where `dismissedAt` is non-null from `memory.reviewCandidates`'s default (`status: 'pending'`) result set and from `listMemories`'s fleeting scope unless `includeDismissed` is `true`; `memory.reviewCandidates` SHALL support a `status` filter (`'pending' \| 'dismissed'`), optional `type`, `search` (LIKE on content), and `tag` filters, `sort` (createdAt asc/desc, default desc), pagination (`limit` default 100 max 200, `offset`), and SHALL return `{ items, total }` where `total` is the count of matching rows before pagination. |
| FR-MEMORY-240 | WHEN a permanent memory is created, updated, deleted, or promoted (`memory.create`/`update`/`delete`/`promote` or the MCP tools `createPermanentMemory`/`updatePermanentMemory`/`promoteMemory`), the system SHALL refresh the memory collection's search index (qmd hash scan, orphaned-vector cleanup, and a background embed pass) as a fire-and-forget, error-swallowed call so the change is searchable — including its embedding — without the mutation waiting on it. This refresh SHALL NOT re-run the permanentMemories filesystem mirror sync, since the mutation already wrote the canonical DB row directly and re-scanning could race with a sibling in-flight mutation's own file-write-then-DB-backfill window. Triggers for the same workspace that arrive while a run is already in flight SHALL be coalesced into a single trailing re-run rather than stacking concurrent runs. |
| FR-MEMORY-250 | WHEN the daemon emits a `CREATE_MEMORIES_EVENT` WS message for a session whose `taskId` or `taskGroupId` resolves to a workspace, the system SHALL insert at most `MAX_MEMORIES_PER_EVENT` (50) fleeting memories from the event's `memories[]`, having first dropped entries with empty content or content exceeding `MAX_MEMORY_CONTENT_LENGTH` (10,000 chars — filtering happens before the 50-item cap is applied, so valid entries are never crowded out by invalid ones), clamping any unrecognized `type` to `'capture'` and forcing `source` to `'agent'` regardless of what the event supplied. IF the session is unknown or its task/task group does not resolve to a workspace, THEN the system SHALL log a warning and insert nothing. |
| FR-MEMORY-260 | WHEN the `listMemories` MCP tool is called with `scope: 'permanent'` or `'both'`, the system SHALL exclude permanent memories whose `supersededById` is non-null from the `permanent` result set unless `includeSuperseded` is `true`, mirroring the `includeDismissed` opt-in already defined for fleeting memories in FR-MEMORY-230. |
| FR-MEMORY-270 | WHEN `memory.reviewCandidateClusters` or the `listReviewClusters` MCP tool is called for a workspace, the system SHALL group that workspace's pending (non-dismissed, non-promoted) fleeting memories into clusters by ad-hoc embedding cosine similarity (threshold 0.88, greedy single-link, largest cluster first, singletons last) without persisting any embedding to the search index, cap clustering at the newest 200 pending candidates and mark the response `truncated: true` when more exist, and return every memory as its own singleton cluster instead of erroring when `QMD_SKIP=1` or the embedded LLM is unavailable. |
| FR-MEMORY-280 | The `memory.reviewCandidateClusters` tRPC procedure and the `listReviewClusters` MCP tool SHALL return the same shape for a given workspace: `{ clusters: [{ ids, memberCount, members }], truncated }`, where each cluster's `members` are the full fleeting memory rows for its `ids`. |

## Sources

No prior knowledge found.
