---
subtype: convention
title: >-
  Calibrate similarity thresholds against the real corpus, never a synthetic
  pair
keywords:
  - DEFAULT_THRESHOLD
  - cosine
  - embedBatch
  - single-link clustering
  - degraded flag
  - calibration
  - chaining
themes:
  - memory
  - search
  - testing
  - calibration
tags:
  - memory
  - testing
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213018-never-compare-a-qmd-search-score-to-a-cosine-threshold.md
  - >-
    memory/facts/20260801212943-fleeting-memories-are-invisible-to-search-until-promoted.md
  - >-
    memory/conventions/20260801213001-assert-mcp-zod-constraints-against-the-schema-not-through-ca.md
  - >-
    memory/insights/20260801212954-qmd-publishes-only-its-root-export-embed-via-store-internal-.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
scenarioIds: []
---
**Rule:** Calibrate a similarity threshold by measuring the real corpus's score distribution, never by constructing one example pair. And whenever a degraded path can produce output shaped identically to a real result, give callers a flag that distinguishes them.

**Why:** a threshold tuned on a constructed example can land above the entire achievable distribution, making the feature a silent no-op. Candidate clustering shipped `DEFAULT_THRESHOLD = 0.88` derived from one hand-reworded pair scoring 0.9158 cosine; measured against the actual queue (75 captures, 2775 pairs, embeddinggemma-300M on raw content) the maximum achievable similarity was 0.8216 with a 0.4038 median. Nothing could ever cluster.

**Evidence:** the bug was undetectable by construction, not merely unnoticed — an all-singleton result is byte-identical to the documented "embedding unavailable" degradation, so no caller could tell "no near-duplicates exist" from "clustering never ran". Diagnosing it required embedding all candidates out-of-band just to see the distribution. Separately, every pre-existing test passed an explicit `threshold: 0.92`, so the default constant had zero coverage — a tuned default that no test exercises is how a dead value survives a green suite.

**Connects to:** single-link clustering makes the threshold sensitive on both sides — at 0.72, chaining merged three unrelated bugs into one cluster — so the safe band is bounded above and below. The chaining outcome is also order-dependent (rows processed createdAt DESC: a bridge candidate seen first absorbs both neighbours, seen last it absorbs one), which any test pinning it must control for.
