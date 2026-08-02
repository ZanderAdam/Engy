---
subtype: decision
title: >-
  Daemon activity badge stays 'done' until typed-into/exit — no view signal
  (deliberate)
repo: engy
keywords:
  - activity badge
  - acknowledge
  - view signal
  - daemon tracker
  - tab dot
  - finished but unacknowledged
themes:
  - terminal
tags:
  - terminal
  - architecture
sources: []
linkedMemories:
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/insights/20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/patterns/20260623233015-terminal-spawn-gate-waiters-must-re-check-spawningsessions-i.md
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
  - >-
    memory/patterns/20260801212722-never-let-dockview-observe-a-zero-size-or-mid-transition-lay.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/insights/20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md
scenarioIds: []
---
T449 design divergence: the daemon tracker omits acknowledge()-on-view (it has no view signal), so a project badge stays 'done' until the user types into that terminal or it exits — viewing it in the browser clears the browser-local tab dot but NOT the daemon-driven badge. Deliberate ('finished but unacknowledged'). If clear-on-view is wanted later, needs a browser→server→daemon 'viewed' signal.
