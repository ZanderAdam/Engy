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
linkedMemories: []
scenarioIds: []
---
Kill-is-final contract: server must send {t:'exit'} to other attached browsers BEFORE close(1001) — client terminal.tsx exit handler calls socket.markFinal() which suppresses ReconnectingSocket's reconnect. Closing alone causes ghost respawn because kill already deleted terminalSessionMeta, so the auto-reconnect is misclassified as a fresh spawn.
