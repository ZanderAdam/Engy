---
subtype: decision
title: 'Codex mode is a single preset dropdown, not its two real flag dimensions'
keywords:
  - codex mode
  - '--ask-for-approval'
  - '--sandbox'
  - buildAgentCommand
  - agent-types registry
  - full-auto
themes:
  - agent-settings
  - ux
tags:
  - agents
  - ui
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801213612-per-agent-settings-fall-back-to-legacy-skill-columns-instead.md
scenarioIds: []
---
**Rule:** Keep Codex's "mode" in workspace agent settings as a single preset dropdown (read-only / workspace-write / full-auto / danger-full-access) mapping to flag COMBINATIONS — full-auto = `--sandbox workspace-write --ask-for-approval never`. Do not expose codex's two real dimensions (`--sandbox`, `--ask-for-approval`) as separate dropdowns.

**Why:** the user explicitly chose the preset shape to mirror Claude's one-dropdown UX.

**Evidence:** `buildAgentCommand` must additionally drop the add-dir flags in the read-only preset, because codex's read-only sandbox rejects `--add-dir` (extra WRITABLE roots) and the CLI refuses to boot.

**Connects to:** Claude's mode list (default/acceptEdits/plan/dontAsk/bypassPermissions) came from the official permission-modes docs. Both lists live in the agent-types registry, so a new agent brings its own modes.
