---
subtype: convention
title: File watching is subscription-driven — a FILE_CHANGE consumer must subscribe
keywords:
  - useWatchPaths
  - useOnFileChange
  - FILE_CHANGE
  - watch-subscriptions.ts
  - watcher.ts
themes:
  - file-watching
  - architecture
tags:
  - architecture
  - daemon
sources: []
linkedMemories:
  - >-
    memory/facts/20260801213252-execution-and-terminal-session-ids-are-separate-namespaces-t.md
scenarioIds: []
---
**Rule:** Any new `FILE_CHANGE` consumer must declare its paths via `useWatchPaths`. The daemon watches ONLY subscribed paths, so a consumer that forgets gets zero events and no error.

**Why:** watching became subscription-driven, and the components CLAUDE.md rule ("`useOnFileChange` requires `useWatchPaths`") is the only guard — the failure is silent.

**Evidence:** the migration was safe because every legacy `FILE_CHANGE` consumer mapped to a UI surface, and three pieces of server machinery (spec timestamps, ring buffer, WORKSPACES_SYNC) turned out to be write-only or sole-consumer dead code — the always-on watcher had no non-UI dependents at all.
