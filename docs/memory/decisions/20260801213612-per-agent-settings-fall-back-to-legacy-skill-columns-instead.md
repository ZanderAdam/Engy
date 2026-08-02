---
subtype: decision
title: Per-agent settings fall back to legacy skill columns instead of migrating
keywords:
  - agent_settings
  - plan_skill
  - implement_skill
  - resolveAgentSkills
  - workspace.yaml
  - drizzle-kit
themes:
  - agent-settings
  - migration
  - tech-debt
tags:
  - agents
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Per-agent workspace settings (the `agent_settings` JSON column keyed by agent-type-id) deliberately keep the legacy `plan_skill`/`implement_skill` columns as a silent fallback rather than doing a data migration. `resolveAgentSkills` resolves agent entry → legacy columns → `/engy:` defaults.

**Why:** drizzle-kit generated migrations must not be hand-edited, so a data backfill would have needed a custom migration. The fallback chain made it unnecessary for a single-user app. The edit dialog seeds claude's skill fields from the legacy columns, so the first save lazily migrates them into `agent_settings`; the legacy columns are no longer editable from the UI.

**Connects to:** `workspace.yaml` still writes the legacy columns — its `planSkill`/`implementSkill` keys have no external consumers (verified by grep) — so it can drift from claude's per-agent skills after the user edits them. Known accepted debt.
