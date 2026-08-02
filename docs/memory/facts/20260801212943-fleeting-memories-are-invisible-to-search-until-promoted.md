---
subtype: fact
title: Fleeting memories are invisible to search until promoted
keywords:
  - fleeting memories
  - qmd
  - search index
  - promoteMemory
  - collection dirs
themes:
  - memory
  - search
tags:
  - memory
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Do not expect `search` to surface anything from fleeting memories. They are DB rows with no backing `.md` file, and qmd indexes only files under the four collection dirs. Promotion is what makes a memory retrievable at all — treat the review backlog as a retrieval outage, not bookkeeping.

**Why:** on live data this was ~85% of everything ever captured (69 unpromoted + 11 promoted fleeting against 12 permanent files), which makes it the dominant root cause of "memory search is poor".

**Connects to:** the second-order effect is that the review flow's own dedup/similarity check cannot compare a candidate against other unpromoted candidates either — only against the permanent set. That is why candidate clustering computes embeddings ad-hoc at review time instead of querying the index.
