---
subtype: fact
title: Use search mode lex or vector — hybrid runs local LLM inference for minutes
keywords:
  - qmd
  - hybrid
  - 'mode: lex'
  - node-llama-cpp
  - intent
  - runQmdSearch
  - reranker
themes:
  - search
  - performance
tags:
  - search
  - dx
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Pass `mode: 'lex'` or `mode: 'vector'` to the MCP `search` tool. Never leave it on the default hybrid, and never pass `intent` unless hybrid is genuinely wanted.

**Why:** hybrid runs local GGUF inference via qmd → node-llama-cpp: query expansion with a 1.7B model plus reranking of the top 40 chunks with a 0.6B Qwen3 reranker. On CPU-only hardware that is minutes, and there is no timeout anywhere in `runQmdSearch` or the MCP handler, so callers wait forever. `intent` additionally disables qmd's strong-signal BM25 bypass, guaranteeing the expansion model runs.

**Evidence:** measured on an idle prod server (Intel i7-9750H) — ~2m17s for a query with strong BM25 signal (rerank only), ~4m59s for a fresh conversational query taking the full expansion path. `lex` and `vector` return in under 0.1s. `trace` is instant in every variant and only appears hung because tool calls queue behind a grinding search in the same turn.

**Connects to:** the engy:research playbook tells agents to always pass `intent`, so skill-driven searches always pay the worst-case path — worth overriding. The workspace's qmd DB lives wherever `docsDir` points, and a `~/.engy/<slug>/.qmd/qmd.db` can be a stale decoy from before `docsDir` was set.

**Contradicts:** the assumption that hybrid search is cheap enough to be a sane default on this hardware.
