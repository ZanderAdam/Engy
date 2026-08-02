---
subtype: convention
title: Grep the whole Requirements table for the max FR id before allocating
keywords:
  - FR id allocation
  - Requirements table
  - system/features
  - renumbering
  - EARS
themes:
  - requirements
  - documentation
tags:
  - process
  - docs
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** When allocating a new FR id in a `system/features` doc, grep the ENTIRE Requirements table for the highest existing id first. Never infer the next id from the section you happen to be reading.

**Why:** the table can be far longer than the visible excerpt, and ids are grouped by theme rather than strictly appended, so the largest id is often not near the bottom of what you are looking at.

**Evidence:** allocating FR-WS-140/150 after reading only up to FR-WS-130 collided with existing ping and GH-PR rows further down. The duplicates were caught only by adversarial review and had to be renumbered to FR-WS-190/200.
