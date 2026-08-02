---
subtype: insight
title: qmd publishes only its root export — embed via store.internal.llm
keywords:
  - '@tobilu/qmd'
  - store.internal.llm
  - embedBatch
  - formatDocForEmbedding
  - exports map
  - searchVector
  - rerank
themes:
  - search
  - embeddings
tags:
  - memory
  - search
sources: []
linkedMemories:
  - >-
    memory/facts/20260801212943-fleeting-memories-are-invisible-to-search-until-promoted.md
  - >-
    memory/conventions/20260801213018-never-compare-a-qmd-search-score-to-a-cosine-threshold.md
scenarioIds: []
---
**Rule:** To embed arbitrary text with qmd, use `store.internal.llm` (LlamaCpp — has `embed`/`embedBatch`). Deep imports fail and the formatting helpers are unavailable, so any threshold tuned against these embeddings must be re-measured if the embed model changes.

**Why:** `@tobilu/qmd`'s package.json exports map publishes only the root entry, so deep imports like `dist/llm.js` fail at runtime, and `formatDocForEmbedding`/`formatQueryForEmbedding` are NOT re-exported from the root (verified `typeof === undefined`). `store.internal.llm` embeds raw unformatted strings — fine for text-vs-text comparison such as candidate clustering, but absolute cosine values differ from qmd's own index embeddings, so a threshold tuned this way silently drifts with the model.

**Connects to:** `rerank: false` on `store.search` does NOT skip LLM query expansion — only `searchVector()` bypasses the LLM entirely. This matters for any call on a hot path.
