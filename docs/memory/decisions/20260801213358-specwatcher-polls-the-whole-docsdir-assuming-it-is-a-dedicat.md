---
subtype: decision
title: 'SpecWatcher polls the whole docsDir, assuming it is a dedicated docs directory'
keywords:
  - SpecWatcher
  - docsDir
  - chokidar
  - polling
  - FILE_CHANGE
  - watcher.ts
themes:
  - file-watching
  - performance
tags:
  - daemon
  - architecture
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213339-file-watching-is-subscription-driven-a-file-change-consumer-.md
  - >-
    memory/decisions/20260801213438-pr-monitoring-authenticates-via-the-user-s-gh-auth-login-sto.md
scenarioIds: []
---
**Rule:** Keep a workspace's `docsDir` pointed at a dedicated docs directory, never a full repo root. SpecWatcher polls the entire `docsDir` at 1s via chokidar, pruning only dot-segments and `node_modules`.

**Why:** pointing `docsDir` at a repo root would make the daemon stat the whole tree every second. A top-level-entry-count guard was considered during review and deliberately rejected for KISS, so nothing prevents it.

**Evidence:** the previous specs/+projects/-only scope was the root cause of the "open docs never refresh" bug. The server rebroadcasts FILE_CHANGE unfiltered and the doc panels already invalidated correctly — the whole refresh pipeline was healthy except for the watcher's scope.
