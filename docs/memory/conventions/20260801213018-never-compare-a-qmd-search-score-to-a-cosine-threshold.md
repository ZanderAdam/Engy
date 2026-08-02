---
subtype: convention
title: Never compare a qmd search score to a cosine threshold
keywords:
  - autoLink
  - SIMILARITY_THRESHOLD
  - rrfRank
  - searchVector
  - rerank
  - MAX_LINKS
  - linkedMemories
themes:
  - search
  - memory
  - scoring
tags:
  - memory
  - search
sources: []
linkedMemories:
  - >-
    memory/facts/20260801212943-fleeting-memories-are-invisible-to-search-until-promoted.md
  - >-
    memory/insights/20260801212954-qmd-publishes-only-its-root-export-embed-via-store-internal-.md
scenarioIds: []
---
**Rule:** Only compare scores to a cosine threshold when they came from `searchVector`. `store.search` with `rerank: false` returns `score = 1/rrfRank` (rank 1 → 1.0, rank 2 → 0.5, rank 3 → 0.33), which is a reciprocal-rank scale, not a 0..1 similarity.

**Why:** mixing the two scales silently truncates results. With `SIMILARITY_THRESHOLD = 0.75` tuned for cosine, only rank 1 could ever clear the bar, so auto-linking created exactly one link per memory and `MAX_LINKS = 5` was unreachable — meaning the `linkedMemories` graph that the research agent BFS-walks was never really populated. Nothing looked broken, because links *were* being created.

**Evidence:** a silent bug of this shape survives indefinitely precisely because the degraded output is well-formed. Compare the same failure mode in candidate clustering, where an unreachable threshold produced only singleton clusters and was indistinguishable from a genuine no-duplicates result.

**Connects to:** `rerank: false` does NOT skip LLM query expansion, so a naive fix leaves every memory create/promote running the local expansion model and contending with user searches on the singleton llama instance. `searchVector` bypasses the LLM entirely and returns real cosines — it is the right call for both reasons.
