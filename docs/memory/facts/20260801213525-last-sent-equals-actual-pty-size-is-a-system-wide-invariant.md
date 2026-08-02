---
subtype: fact
title: Last-sent equals actual PTY size is a system-wide invariant
keywords:
  - terminalSessionMeta.cols
  - fitAndSyncResize
  - resize
  - PTY size
  - 80x24
  - relay outage
themes:
  - terminal
  - websocket
tags:
  - terminal
  - architecture
sources: []
linkedMemories:
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/patterns/20260801213516-cross-cutting-terminal-views-read-the-server-registry-not-th.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/conventions/20260801213533-the-relay-sync-no-browser-branch-must-do-full-worker-teardow.md
scenarioIds: []
---
**Rule:** Treat "last sent cols/rows === actual PTY size" as a system-wide invariant. Any server or daemon path that changes a PTY's size, or drops a resize, without the browser seeing a WS reconnect leaves that PTY permanently stuck — no focus or refit will ever resend. Server-side healing must come from `terminalSessionMeta.cols/rows`.

**Why:** the browser sends `{t:'resize'}` only when its fitted dimensions differ from the last size it successfully sent (guard refs in `terminal.tsx`). Once the browser believes it is in sync, nothing re-triggers. This is why resize messages update the meta and why daemon sync re-asserts or respawns at the last known size.

**Evidence:** the bug had two independent triggers with identical symptoms — PTY stuck at a stale size until sidebar collapse/expand or a page refresh. Transparent respawn after daemon restart used meta cols/rows frozen at the hardcoded 80x24 spawn defaults; and resizes sent during a relay outage were silently dropped at the server while the browser's guard recorded them as sent.

**Connects to:** the guard-update-only-when-socket-OPEN rule already commented in `fitAndSyncResize`.
