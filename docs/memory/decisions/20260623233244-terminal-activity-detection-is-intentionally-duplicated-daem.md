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
linkedMemories:
  - >-
    memory/patterns/20260623233015-terminal-spawn-gate-waiters-must-re-check-spawningsessions-i.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/insights/20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/insights/20260801212834-resync-xterm-s-viewport-when-a-hidden-dockview-panel-becomes.md
  - >-
    memory/conventions/20260801212843-never-mirror-xterm-s-auto-follow-state-in-app-code.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
scenarioIds: []
---
T449 (per-project terminal activity badges): activity detection is computed daemon-side in client/src/terminal/ (activity-parse.ts + activity-tracker.ts) as INTENTIONAL duplicates of the web/ versions — common/ is types-only so the runtime logic can't be shared. The two daemon files are added to .jscpd.json ignore for that reason. Don't 'dedupe' them into common.
