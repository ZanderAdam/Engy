---
subtype: insight
title: Wake-triggered clear-and-replay is what corrupts terminal scrollback
keywords:
  - ReconnectingSocket
  - handleWake
  - visibilitychange
  - CircularBuffer
  - term.clear
  - scrollback
  - PTY chunks
themes:
  - terminal
  - websocket
tags:
  - terminal
  - frontend
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Do not force-close a healthy terminal socket on `visibilitychange`. Probe liveness instead — the clear-and-replay cycle it triggers both corrupts scrollback and truncates history.

**Why:** `ReconnectingSocket.handleWake()` force-closed even an OPEN socket on every `visibilitychange → visible` and `online` event as post-sleep zombie-socket defense. Merely switching back to the browser tab therefore reconnects → server reconnect path → daemon replays its CircularBuffer → `term.clear()` + `write(buffer.join(''))`. Replaying raw TUI repaint chunks (cursor-relative moves, partial-line rewrites, recorded at historical PTY widths) into a cleared xterm at the current size produces torn, interleaved scrollback. The `clear()` also discards up to 5000 lines of accumulated browser scrollback and replaces it with the daemon's last 1000 *chunks*.

**Evidence:** chunk ≠ line. The "1000-line" ring buffer actually stores whole PTY chunks — a spinner frame or a single keystroke echo is one chunk, so 1000 chunks can be under two minutes of TUI output. On ring wrap the oldest chunk can start mid-ANSI-escape, adding garbage at the top of every replay.

**Connects to:** the replacement is a ping/pong wake probe — force-reconnect only when a 3s probe times out.
