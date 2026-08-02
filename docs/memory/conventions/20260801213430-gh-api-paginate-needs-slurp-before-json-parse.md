---
subtype: convention
title: gh api --paginate needs --slurp before JSON.parse
keywords:
  - gh api
  - '--paginate'
  - '--slurp'
  - JSON.parse
  - fetchReviewComments
  - pagination
themes:
  - github
  - daemon
tags:
  - daemon
  - tooling
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Every `gh api --paginate` call in the daemon must add `--slurp` (then `.flat()`), or split on newlines. Never `JSON.parse(stdout)` directly.

**Why:** `--paginate` emits one JSON array PER PAGE separated by newlines, so `JSON.parse` throws as soon as a result set exceeds one page (30 items). `--slurp` wraps the pages in an outer array.

**Evidence:** the failure is silent in practice — the poller catches per-PR errors, so review-comment import would simply stop working for PRs with more than 30 comments. A unit test with a single-array mock could never catch it; an adversarial reviewer did.
