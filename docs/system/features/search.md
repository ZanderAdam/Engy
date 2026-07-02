---
title: Search
order: 1
description: Hybrid search across collections, structured filters, and query-shape reranking.
---

# Search

Unified discovery across the four file collections (`system`, `docs`, `projects`,
`memory`) plus `tasks`. A single entry point handles three shapes — semantic
query, structured frontmatter filters, or both — and normalises qmd's hybrid
(BM25 + vector + rerank), lexical, and vector modes into one result shape.

Implementation lives in `web/src/server/search/` (`qmd-search.ts`,
`subtype-affinity.ts`, `memory-queries.ts`) and is exposed via the
`search` tRPC procedure (`web/src/server/trpc/routers/search.ts`) and the
`search` MCP tool (`web/src/server/mcp/index.ts`).

## Requirements

Functional requirements in EARS notation. These are the single source of truth
for the search feature's behaviour. Tag the verifying tests with the FR id in
their title string, e.g. `it('[FR-SEARCH-003] ...', ...)`, and run
`trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-SEARCH-001 | The system SHALL search the four file collections (system, docs, projects, memory) and tasks, returning results grouped by collection. |
| FR-SEARCH-002 | WHEN a query is supplied without filters, the system SHALL rank file results using the selected mode (hybrid by default) and attach a relevance score to each hit. |
| FR-SEARCH-003 | WHEN a query and filters are both supplied, the system SHALL return every frontmatter-matching row with the qmd score attached where available, so filter matches are never dropped by the qmd top-N cutoff. |
| FR-SEARCH-004 | IF the embedding model is unavailable, THEN the system SHALL fail with a PRECONDITION_FAILED error instructing the user to run reindex. |
| FR-SEARCH-005 | WHEN a query begins with "why", the system SHALL boost the decision and insight subtypes above pattern, fact, and convention. |
| FR-SEARCH-006 | WHEN a query begins with "where", the system SHALL boost the fact subtype above pattern. |
| FR-SEARCH-007 | WHEN a query is a bare UPPER_SNAKE_CASE identifier, the system SHALL boost canonical fact and decision definitions. |
| FR-SEARCH-008 | The system SHALL exclude superseded memories from every result set. |
| FR-SEARCH-009 | WHEN only filters are supplied, the system SHALL match frontmatter via JSON1 array-membership and scalar-equality, ANDing all conditions together. |
| FR-SEARCH-010 | WHERE the mode is `lex` or `vector`, the system SHALL rank using BM25-only or embedding-only respectively rather than the hybrid blend. |
| FR-SEARCH-011 | WHILE a subtype filter is active in query-and-filters mode, the system SHALL widen the qmd candidate pool (up to 8×) so the filtered subset is well covered before the join. |
| FR-SEARCH-012 | WHEN a query is supplied without filters, the system SHALL attach each file hit's frontmatter subtype and tags (where present) to its result so the UI can display them. |
