---
subtype: insight
title: Terminal tab title pin (titlePinned) is browser-local; lost in 4 cases
repo: engy
keywords:
  - titlePinned
  - OSC title
  - dockview
  - localStorage
  - TerminalSessionMeta
  - sessions/rename
  - scheduleLayoutSave
themes:
  - terminal
  - tech-debt
tags:
  - terminal
  - tech-debt
  - osc-titles
sources: []
linkedMemories:
  - >-
    memory/patterns/20260623233015-terminal-spawn-gate-waiters-must-re-check-spawningsessions-i.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/patterns/20260801212703-drive-xterm-scrolling-yourself-its-native-wheel-and-touch-pa.md
scenarioIds: []
---
Known debt — terminal tab title pin (titlePinned) is browser-local only. A manual rename pins the tab label against OSC 0/2 title overwrites, persisted via the dockview layout snapshot in localStorage (saved debounced 200ms in scheduleLayoutSave). The pin is lost when: (1) reload happens within the 200ms debounce after the rename, (2) any saved panel's session has died (allAlive=false clears the layout and tabs rebuild via sessionToTab without the pin), (3) a different browser opens the workspace, or (4) a tab arrives via the cross-browser TERMINAL_SESSIONS_CHANGE 'created' sync path. In all four cases a running title-emitter (e.g. Claude Code) overrides the manually renamed label again. Complete fix: persist titlePinned server-side alongside the rename — /api/terminal/sessions/rename is the natural carrier (add to TerminalSessionMeta and the sessions list response). Accepted as out of scope for the browser-side-only OSC tab titles feature.
