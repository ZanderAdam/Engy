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
linkedMemories: []
scenarioIds: []
---
T449 design divergence: the daemon tracker omits acknowledge()-on-view (it has no view signal), so a project badge stays 'done' until the user types into that terminal or it exits — viewing it in the browser clears the browser-local tab dot but NOT the daemon-driven badge. Deliberate ('finished but unacknowledged'). If clear-on-view is wanted later, needs a browser→server→daemon 'viewed' signal.
