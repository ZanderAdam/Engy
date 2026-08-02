---
subtype: decision
title: The terminal rail's dots mode is deliberately focus-only
keywords:
  - terminal rail
  - dots mode
  - cloneScopeForNewTerminal
  - new-terminal-scope
  - Command Center
themes:
  - terminal
  - ux-conventions
tags:
  - ui
  - terminal
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Keep the terminal rail's collapsed "dots" mode focus-only. All management actions — rename, close, per-project new-terminal creation — live exclusively in the expanded list mode.

**Why:** rename and close are already expanded-only, so creation-only-in-expanded is consistent with the existing interaction design. A label that spawns terminals on click also invites accidental spawns in a 10px-wide rail.

**Evidence:** a code review flagged the missing per-project "+" in dots mode as an a11y/parity gap and proposed making the dots-mode project label a create-terminal button. Declined for the reasons above.

**Connects to:** `cloneScopeForNewTerminal` also deliberately refuses non-project sources, so the "Other terminals" bucket never gets a "+".
