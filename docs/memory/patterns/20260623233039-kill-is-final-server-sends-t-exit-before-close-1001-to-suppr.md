---
subtype: pattern
title: >-
  Kill-is-final: server sends {t:'exit'} before close(1001) to suppress ghost
  respawn
repo: engy
keywords:
  - markFinal
  - exit message
  - close 1001
  - ReconnectingSocket
  - terminalSessionMeta
  - ghost respawn
  - terminal.tsx
themes:
  - terminal
  - websocket
tags:
  - terminal
  - websocket
sources: []
linkedMemories:
  - >-
    memory/insights/20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md
  - >-
    memory/patterns/20260623233015-terminal-spawn-gate-waiters-must-re-check-spawningsessions-i.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
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
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/insights/20260801213220-wake-triggered-clear-and-replay-is-what-corrupts-terminal-sc.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/insights/20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md
  - >-
    memory/insights/20260801213319-initial-command-injection-races-interactive-shell-startup.md
scenarioIds: []
---
Kill-is-final contract: server must send {t:'exit'} to other attached browsers BEFORE close(1001) — client terminal.tsx exit handler calls socket.markFinal() which suppresses ReconnectingSocket's reconnect. Closing alone causes ghost respawn because kill already deleted terminalSessionMeta, so the auto-reconnect is misclassified as a fresh spawn.
