---
subtype: decision
title: >-
  Terminal activity detection is intentionally duplicated daemon-side (common is
  types-only)
repo: engy
keywords:
  - activity-parse.ts
  - activity-tracker.ts
  - jscpd ignore
  - common types-only
  - daemon
  - duplicate
themes:
  - terminal
  - monorepo
tags:
  - terminal
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
T449 (per-project terminal activity badges): activity detection is computed daemon-side in client/src/terminal/ (activity-parse.ts + activity-tracker.ts) as INTENTIONAL duplicates of the web/ versions — common/ is types-only so the runtime logic can't be shared. The two daemon files are added to .jscpd.json ignore for that reason. Don't 'dedupe' them into common.
