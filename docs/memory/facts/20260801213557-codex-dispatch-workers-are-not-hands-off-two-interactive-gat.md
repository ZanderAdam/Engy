---
subtype: fact
title: Codex dispatch workers are not hands-off — two interactive gates block them
keywords:
  - codex
  - '--sandbox workspace-write'
  - '--add-dir'
  - terminal_reply
  - trust this directory
  - acceptEdits
themes:
  - dispatch
  - agent-types
tags:
  - mcp
  - agents
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213547-an-injected-prompt-must-state-that-the-terminal-is-invisible.md
scenarioIds: []
---
**Rule:** Do not assume a Codex terminal spawned as a dispatch worker can answer autonomously. Two interactive gates need a human Enter/"Allow" in the Codex TUI first: the initial "Do you trust this directory?" prompt, and an approval prompt on every `terminal_reply` MCP call. Also default the Codex adapter to `--sandbox workspace-write`.

**Why:** `--add-dir` hard-errors and exits the process when the sandbox is read-only (the default) — "Ignoring --add-dir because the effective permissions do not allow additional writable roots" — and read-only would make Codex unable to edit code at all. `workspace-write` is the real equivalent of Claude's `--permission-mode acceptEdits`. Claude workers do not hit either gate the same way; their MCP tools run under acceptEdits without per-call prompts.

**Evidence:** the dispatch mechanism itself works end-to-end — verified live: dispatch → injected paste → Codex computed 6*7 → called `terminal_reply({result:"42"})` → `terminal_collect` returned `status:replied, result:42`. The gates are the only blocker.

**Connects to:** openai/codex#24135 — headless MCP tool calls cannot be approved non-interactively without `--dangerously-bypass-approvals-and-sandbox`. A truly hands-off Codex worker would need "Always allow" pre-set or a broader approval config.
