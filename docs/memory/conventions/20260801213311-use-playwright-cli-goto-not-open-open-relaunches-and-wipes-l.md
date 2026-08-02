---
subtype: convention
title: 'Use playwright-cli goto, not open — open relaunches and wipes localStorage'
keywords:
  - playwright-cli
  - goto
  - open
  - localStorage
  - engy-theme-flavor
  - viewport
themes:
  - ui-testing
  - tooling
tags:
  - testing
  - dx
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Use `goto <url>` for navigation within a playwright-cli session. Reserve `open` for the first launch, and after any relaunch re-apply: resize, `eval localStorage.setItem('engy-theme-flavor','cyberpunk')`, reload.

**Why:** `open <url>` relaunches the browser process when the previous one has exited, which wipes localStorage and resets the viewport to 1280x720 — silently dropping the theme flavor under test. The relaunch is easy to miss: the command output looks identical except for a new pid line, and screenshots quietly come back in the default dark theme.

**Connects to:** always pass `-s=<name>` — the default session is shared across concurrent Claude sessions.
