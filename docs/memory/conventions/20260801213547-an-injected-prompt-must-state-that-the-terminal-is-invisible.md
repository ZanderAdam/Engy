---
subtype: convention
title: An injected prompt must state that the terminal is invisible to the requester
keywords:
  - replyContract
  - terminal-dispatch
  - terminal_reply
  - injected prompt
  - MCP tool result
themes:
  - prompt-engineering
  - dispatch
tags:
  - mcp
  - prompting
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** When an injected prompt asks a CLI agent to return a value via an MCP tool, the contract must state that the terminal is INVISIBLE to the requester and that the tool's result field carries the answer itself.

**Why:** without it, agents print the answer in the terminal and call the tool with a meta status note ("responded with pong"), so the requester receives the note instead of the answer. The failure mode is not refusing the tool call — the agent happily calls it, just with the wrong content. Wording like "report the outcome" actively invites a status report.

**Evidence:** observed with real Codex.
