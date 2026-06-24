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
scenarioIds: []
---
Kill-is-final contract: server must send {t:'exit'} to other attached browsers BEFORE close(1001) — client terminal.tsx exit handler calls socket.markFinal() which suppresses ReconnectingSocket's reconnect. Closing alone causes ghost respawn because kill already deleted terminalSessionMeta, so the auto-reconnect is misclassified as a fresh spawn.
